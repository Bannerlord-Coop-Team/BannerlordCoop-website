-- Website-owned additive history. No provider credentials or raw provider responses.
create table public.membership_heads (
 account_id uuid primary key, discord_user_id text check(discord_user_id ~ '^[0-9]{17,20}$'),
 patreon_user_id text unique check(patreon_user_id ~ '^[1-9][0-9]{0,31}$'),
 link_generation bigint not null default 0 check(link_generation >= 0),
 revision bigint not null default 0 check(revision >= 0),
 link_state text not null default 'unlinked' check(link_state in ('linked','unlinked','identity_changed','account_deleted')),
 mutation_window_started_at timestamptz not null default clock_timestamp(),
 mutation_count integer not null default 0 check(mutation_count between 0 and 10),
 evidence jsonb not null default '{"verification":"unverified","campaignId":null,"memberId":null,"tierIds":[],"verifiedAt":null,"paidThroughAt":null,"policyVersion":"patreon-paid-usd20-v1","evidenceSha256":null}'::jsonb
);
create table public.membership_outbox (
 sequence bigint generated always as identity primary key,
 event_id uuid not null unique default gen_random_uuid(), account_id uuid not null references public.membership_heads(account_id),
 revision bigint not null, receipt_id uuid, created_at timestamptz not null default clock_timestamp(), acknowledged_at timestamptz,
 unique(account_id, revision), check ((receipt_id is null) = (acknowledged_at is null))
);
-- Keep admission and delivery scans bounded by pending work, not retained receipts.
create index membership_outbox_pending_account on public.membership_outbox(account_id,revision) where receipt_id is null;
create index membership_outbox_pending_sequence on public.membership_outbox(sequence) where receipt_id is null;
create table public.membership_completion_receipts (
 operation_id uuid primary key, account_id uuid not null references public.membership_heads(account_id),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 payload_sha256 text not null, result jsonb not null, committed_at timestamptz not null default clock_timestamp()
);
alter table public.patreon_oauth_states add column operation_id uuid;
alter table public.patreon_oauth_states add column expected_generation bigint;
alter table public.patreon_oauth_states add column return_path text check(return_path in ('/account','/servers'));
alter table public.patreon_oauth_states add column evidence jsonb;
create unique index membership_oauth_operation on public.patreon_oauth_states(operation_id) where operation_id is not null;
create index membership_oauth_account_expiry on public.patreon_oauth_states(user_id,expires_at);
create table public.discord_link_requests (
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'), operation_id uuid not null unique,
 account_id uuid not null references public.membership_heads(account_id), return_path text not null check(return_path in ('/account','/servers')),
 expires_at timestamptz not null, confirmed_discord_id text, confirmed_at timestamptz
);

alter table public.membership_heads enable row level security;
alter table public.membership_outbox enable row level security;
alter table public.membership_completion_receipts enable row level security;
alter table public.discord_link_requests enable row level security;
revoke all on public.membership_heads, public.membership_outbox, public.membership_completion_receipts, public.discord_link_requests from public, anon, authenticated;
-- Service authority uses narrow RPCs; state issuance still uses the existing server-only table.
revoke all on public.membership_heads, public.membership_outbox, public.membership_completion_receipts, public.discord_link_requests from service_role;

create function public.membership_empty_evidence() returns jsonb language sql immutable set search_path = '' as $$
 select '{"verification":"unverified","campaignId":null,"memberId":null,"tierIds":[],"verifiedAt":null,"paidThroughAt":null,"policyVersion":"patreon-paid-usd20-v1","evidenceSha256":null}'::jsonb
$$;
create function public.membership_snapshot_json(h public.membership_heads) returns jsonb language sql stable set search_path = '' as $$
 select jsonb_build_object('version',1,'accountId',h.account_id,'discordUserId',h.discord_user_id,'patreonUserId',h.patreon_user_id,'linkGeneration',h.link_generation::text,'revision',h.revision::text,'linkState',h.link_state) || h.evidence
$$;
-- Technical abuse bounds, not entitlement policy. All writers hold the global
-- commit-order lock and account lock before admission or notification.
create function public.membership_notify(p_account_id uuid, p_revocation boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare current_revision bigint; pending_count integer;
begin
 select revision into strict current_revision from public.membership_heads where account_id=p_account_id;
 if exists(select 1 from public.membership_outbox where account_id=p_account_id and revision=current_revision) then return; end if;
 select count(*) into pending_count from public.membership_outbox where account_id=p_account_id and receipt_id is null;
 if pending_count >= (case when p_revocation then 9 else 8 end) then
  if p_revocation then return; end if; -- surviving hints durably wake ack repair below
  raise sqlstate 'PT429' using message='membership_rate_limited';
 end if;
 insert into public.membership_outbox(account_id,revision) values(p_account_id,current_revision);
end $$;
create function public.membership_admit(p_account_id uuid, p_pending boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare h public.membership_heads; pending_count integer;
begin
 select * into strict h from public.membership_heads where account_id=p_account_id for update;
 if clock_timestamp() >= h.mutation_window_started_at + interval '10 minutes' then
  update public.membership_heads set mutation_window_started_at=clock_timestamp(),mutation_count=0 where account_id=p_account_id returning * into h;
 end if;
 if h.mutation_count>=10 or (select count(*) from public.membership_outbox where account_id=p_account_id and receipt_id is null)>=8 then
  raise sqlstate 'PT429' using message='membership_rate_limited';
 end if;
 -- Only ephemeral authority is discarded. Durable completion/ack receipts survive.
 delete from public.patreon_oauth_states where user_id=p_account_id and (expires_at<=clock_timestamp() or expected_generation<>h.link_generation);
 delete from public.discord_link_requests where account_id=p_account_id and confirmed_at is null and expires_at<=clock_timestamp();
 if p_pending then
  select (select count(*) from public.patreon_oauth_states where user_id=p_account_id) +
   (select count(*) from public.discord_link_requests where account_id=p_account_id and confirmed_at is null) into pending_count;
  if pending_count>=4 then raise sqlstate 'PT429' using message='membership_rate_limited'; end if;
 end if;
 update public.membership_heads set mutation_count=mutation_count+1 where account_id=p_account_id;
end $$;
-- Callback replacements also take admission locks: a consumed token cannot be
-- reissued after unlink/new generation, nor race past the pending-authority bound.
create function public.membership_oauth_admission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare generation bigint;
begin
 if new.operation_id is null or new.expected_generation is null then raise exception 'Missing membership operation'; end if;
 perform pg_advisory_xact_lock(702,1);
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,702));
 select link_generation into strict generation from public.membership_heads where account_id=new.user_id for update;
 if generation<>new.expected_generation then raise exception 'Link generation changed'; end if;
 if (select count(*) from public.patreon_oauth_states where user_id=new.user_id and expires_at>clock_timestamp() and expected_generation=generation) +
  (select count(*) from public.discord_link_requests where account_id=new.user_id and confirmed_at is null and expires_at>clock_timestamp()) >=4 then
  raise sqlstate 'PT429' using message='membership_rate_limited';
 end if;
 return new;
end $$;
create trigger membership_oauth_admission before insert on public.patreon_oauth_states for each row execute function public.membership_oauth_admission();

-- Caller MUST first read the exact account via Auth admin API. Auth outages never call this RPC.
create function public.membership_fence(p_account_id uuid, p_discord_user_id text, p_deleted boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h public.membership_heads; current_patreon text; state text;
begin
 perform pg_advisory_xact_lock(702,1); -- no cursor can skip an uncommitted lower sequence
 perform pg_advisory_xact_lock(hashtextextended(p_account_id::text, 702));
 insert into public.membership_heads(account_id) values(p_account_id) on conflict do nothing;
 select * into strict h from public.membership_heads where account_id=p_account_id for update;
 if p_deleted then current_patreon := null; state := 'account_deleted';
 else
  if h.link_state='account_deleted' then raise exception 'Deleted account cannot be resurrected'; end if;
  select patreon_user_id into current_patreon from public.patreon_accounts where user_id=p_account_id;
  state := case when current_patreon is null then 'unlinked' when h.discord_user_id is distinct from p_discord_user_id then 'identity_changed' else h.link_state end;
  if current_patreon is not null and h.patreon_user_id is distinct from current_patreon then state := 'identity_changed'; end if;
 end if;
 if h.discord_user_id is distinct from p_discord_user_id or h.patreon_user_id is distinct from current_patreon or h.link_state is distinct from state then
  update public.membership_heads set discord_user_id=case when p_deleted then null else p_discord_user_id end, patreon_user_id=current_patreon,
   link_generation=link_generation+1, revision=revision+1, link_state=state, evidence=public.membership_empty_evidence()
   where account_id=p_account_id returning * into h;
  perform public.membership_notify(p_account_id,true);
 end if;
 return public.membership_snapshot_json(h);
end $$;

create function public.membership_begin(p_account_id uuid, p_discord_user_id text, p_operation_id uuid, p_token_hash text, p_return_path text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare snapshot jsonb;
begin
 snapshot := public.membership_fence(p_account_id,p_discord_user_id,false);
 perform public.membership_admit(p_account_id,true);
 -- An explicit refresh invalidates old positive evidence immediately, including
 -- cancellation/outage after launch. Tokens cannot refresh membership unattended.
 update public.membership_heads set evidence=public.membership_empty_evidence() || '{"verification":"unknown"}'::jsonb, link_generation=link_generation+1, revision=revision+1 where account_id=p_account_id;
 -- A newer explicit verification generation fences every older OAuth completion.
 select public.membership_snapshot_json(h) into snapshot from public.membership_heads h where account_id=p_account_id;
 perform public.membership_notify(p_account_id,false);
 insert into public.patreon_oauth_states(token_hash,kind,user_id,expires_at,operation_id,expected_generation,return_path)
 values(p_token_hash,'ticket',p_account_id,clock_timestamp()+interval '10 minutes',p_operation_id,(snapshot->>'linkGeneration')::bigint,p_return_path);
 return jsonb_build_object('started',true);
end $$;

create function public.membership_complete(p_account_id uuid, p_discord_user_id text, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.patreon_oauth_states; h public.membership_heads; r public.membership_completion_receipts; result jsonb; payload text;
begin
 perform pg_advisory_xact_lock(702,1); -- serialize outbox sequence with commit order
 perform pg_advisory_xact_lock(hashtextextended(p_account_id::text,702));
 -- Receipt recovery does not require unexpired OAuth authority or still-positive evidence.
 select * into r from public.membership_completion_receipts where token_hash=p_token_hash;
 if found then
  if r.account_id<>p_account_id then raise exception 'Completion account conflict'; end if;
  perform public.membership_fence(p_account_id,p_discord_user_id,false);
  return r.result;
 end if;
 perform public.membership_fence(p_account_id,p_discord_user_id,false);
 select * into s from public.patreon_oauth_states where token_hash=p_token_hash and kind='complete' for update;
 if not found or s.user_id<>p_account_id or s.expires_at<=clock_timestamp() or s.operation_id is null or s.evidence is null then raise exception 'Invalid completion authority'; end if;
 select * into strict h from public.membership_heads where account_id=p_account_id for update;
 if h.link_generation<>s.expected_generation then raise exception 'Link generation changed'; end if;
 if s.patreon_user_id !~ '^[1-9][0-9]{0,31}$' or jsonb_typeof(s.evidence)<>'object'
  or (select count(*) from jsonb_object_keys(s.evidence))<>8
  or not (s.evidence ?& array['verification','campaignId','memberId','tierIds','verifiedAt','paidThroughAt','policyVersion','evidenceSha256'])
  or s.evidence->>'policyVersion'<>'patreon-paid-usd20-v1'
  or s.evidence->>'verification' not in ('qualifying','nonqualifying','unknown','review_required','unverified') then raise exception 'Invalid evidence'; end if;
 perform public.membership_admit(p_account_id,false);
 payload := encode(sha256(convert_to(jsonb_build_object('accountId',p_account_id,'generation',s.expected_generation,'patreonId',s.patreon_user_id,'evidence',s.evidence,'returnPath',s.return_path)::text,'UTF8')),'hex');
 if exists(select 1 from public.membership_completion_receipts where operation_id=s.operation_id) then raise exception 'Completion payload conflict'; end if;
 insert into public.patreon_accounts(user_id,patreon_user_id,linked_at) values(p_account_id,s.patreon_user_id,clock_timestamp())
 on conflict(user_id) do update set patreon_user_id=excluded.patreon_user_id,linked_at=excluded.linked_at;
 update public.membership_heads set patreon_user_id=s.patreon_user_id,discord_user_id=p_discord_user_id,link_state='linked',
  link_generation=link_generation+case when patreon_user_id is distinct from s.patreon_user_id or link_state<>'linked' then 1 else 0 end,
  revision=revision+1,evidence=s.evidence where account_id=p_account_id returning * into h;
 perform public.membership_notify(p_account_id,false);
 result := jsonb_build_object('linked',true,'operationId',s.operation_id,'returnPath',s.return_path);
 insert into public.membership_completion_receipts(operation_id,account_id,token_hash,payload_sha256,result) values(s.operation_id,p_account_id,p_token_hash,payload,result);
 delete from public.patreon_oauth_states where token_hash=p_token_hash;
 return result;
end $$;

create function public.membership_unlink(p_account_id uuid,p_discord_user_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h public.membership_heads; needs_fence boolean;
begin
 perform pg_advisory_xact_lock(702,1);
 perform pg_advisory_xact_lock(hashtextextended(p_account_id::text,702));
 perform public.membership_fence(p_account_id,p_discord_user_id,false);
 select * into strict h from public.membership_heads where account_id=p_account_id for update;
 -- In-flight callbacks may have consumed their row: unknown evidence also marks
 -- a launched generation which must be fenced, even with no row currently present.
 needs_fence := h.patreon_user_id is not null or h.link_state<>'unlinked' or h.evidence<>public.membership_empty_evidence()
  or exists(select 1 from public.patreon_oauth_states where user_id=p_account_id and expected_generation=h.link_generation and expires_at>clock_timestamp());
 delete from public.patreon_oauth_states where user_id=p_account_id;
 delete from public.patreon_accounts where user_id=p_account_id;
 if needs_fence then
  -- Revocation uses reserved/deferred notification capacity, never ordinary budget.
  update public.membership_heads set patreon_user_id=null,link_state='unlinked',link_generation=link_generation+1,revision=revision+1,evidence=public.membership_empty_evidence() where account_id=p_account_id returning * into h;
  perform public.membership_notify(p_account_id,true);
 end if;
 return public.membership_snapshot_json(h);
end $$;
create function public.membership_changes(p_cursor text,p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
 if p_limit is null or p_limit not between 1 and 50 or (p_cursor is not null and p_cursor !~ '^(0|[1-9][0-9]{0,19})$') then raise exception 'Invalid page'; end if;
 select jsonb_build_object('version',1,'cursor',coalesce(max(sequence)::text,p_cursor),'events',coalesce(jsonb_agg(jsonb_build_object('eventId',event_id,'accountId',account_id) order by sequence),'[]'::jsonb)) into result
 from (select sequence,event_id,account_id from public.membership_outbox where receipt_id is null and (p_cursor is null or sequence::numeric>p_cursor::numeric) order by sequence limit p_limit) page;
 return result;
end $$;
create function public.membership_ack(p_event_id uuid,p_receipt_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare current_receipt uuid; account uuid;
begin
 perform pg_advisory_xact_lock(702,1);
 select account_id into account from public.membership_outbox where event_id=p_event_id;
 if not found then raise exception 'Receipt conflict'; end if;
 perform pg_advisory_xact_lock(hashtextextended(account::text,702));
 select receipt_id into current_receipt from public.membership_outbox where event_id=p_event_id for update;
 if not found or (current_receipt is not null and current_receipt<>p_receipt_id) then raise exception 'Receipt conflict'; end if;
 update public.membership_outbox set receipt_id=p_receipt_id,acknowledged_at=coalesce(acknowledged_at,clock_timestamp()) where event_id=p_event_id;
 -- Even an old/replayed ack repairs the newest head, not the acknowledged revision.
 -- No Auth lookup is required, so deleted-account tombstones remain deliverable.
 perform public.membership_notify(account,true);
 return jsonb_build_object('version',1,'acknowledged',true,'eventId',p_event_id,'receiptId',p_receipt_id);
end $$;
create function public.membership_status(p_account_id uuid,p_discord_user_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare snapshot jsonb; pending boolean;
begin
 snapshot := public.membership_fence(p_account_id,p_discord_user_id,false);
 select exists(select 1 from public.membership_outbox where account_id=p_account_id and receipt_id is null) into pending;
 return jsonb_build_object('snapshot',snapshot,'pending',pending,'verificationPending',exists(select 1 from public.patreon_oauth_states where user_id=p_account_id and expected_generation=(snapshot->>'linkGeneration')::bigint and expires_at>clock_timestamp()));
end $$;
create function public.membership_discord_begin(p_account_id uuid,p_token_hash text,p_operation_id uuid,p_return_path text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 perform public.membership_fence(p_account_id,null,false);
 perform public.membership_admit(p_account_id,true);
 insert into public.discord_link_requests(token_hash,operation_id,account_id,return_path,expires_at) values(p_token_hash,p_operation_id,p_account_id,p_return_path,clock_timestamp()+interval '10 minutes');
 return jsonb_build_object('started',true);
end $$;
create function public.membership_discord_confirm(p_account_id uuid,p_token_hash text,p_discord_user_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.discord_link_requests;
begin
 perform pg_advisory_xact_lock(702,1); -- serialize outbox sequence with commit order
 perform pg_advisory_xact_lock(hashtextextended(p_account_id::text,702));
 select * into r from public.discord_link_requests where token_hash=p_token_hash for update;
 if not found or r.account_id<>p_account_id or r.expires_at<=clock_timestamp() or p_discord_user_id is null
  or (r.confirmed_discord_id is not null and r.confirmed_discord_id<>p_discord_user_id) then raise exception 'Discord linking conflict'; end if;
 if r.confirmed_at is null then perform public.membership_admit(p_account_id,false); end if;
 perform public.membership_fence(p_account_id,p_discord_user_id,false);
 update public.discord_link_requests set confirmed_discord_id=p_discord_user_id,confirmed_at=coalesce(confirmed_at,clock_timestamp()) where token_hash=p_token_hash;
 return jsonb_build_object('confirmed',true,'returnPath',r.return_path);
end $$;
create function public.membership_auth_deleted() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 perform public.membership_fence(old.id,null,true);
 return old;
end $$;
create trigger membership_auth_deleted before delete on auth.users for each row execute function public.membership_auth_deleted();
-- Preserve existing links as unverified; never turn identity-only history into allowance.
insert into public.membership_heads(account_id,patreon_user_id,link_generation,revision,link_state)
 select user_id,patreon_user_id,1,1,'linked' from public.patreon_accounts;
insert into public.membership_outbox(account_id,revision) select account_id,revision from public.membership_heads;

revoke all on function public.membership_empty_evidence(),public.membership_snapshot_json(public.membership_heads),public.membership_fence(uuid,text,boolean),public.membership_begin(uuid,text,uuid,text,text),public.membership_complete(uuid,text,text),public.membership_unlink(uuid,text),public.membership_changes(text,integer),public.membership_ack(uuid,uuid),public.membership_status(uuid,text),public.membership_discord_begin(uuid,text,uuid,text),public.membership_discord_confirm(uuid,text,text),public.membership_auth_deleted() from public,anon,authenticated;
grant execute on function public.membership_fence(uuid,text,boolean),public.membership_begin(uuid,text,uuid,text,text),public.membership_complete(uuid,text,text),public.membership_unlink(uuid,text),public.membership_changes(text,integer),public.membership_ack(uuid,uuid),public.membership_status(uuid,text),public.membership_discord_begin(uuid,text,uuid,text),public.membership_discord_confirm(uuid,text,text) to service_role;

create function public.membership_discord_check(p_account_id uuid,p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 if not exists(select 1 from public.discord_link_requests where token_hash=p_token_hash and account_id=p_account_id and expires_at>clock_timestamp()) then raise exception 'Discord initiation mismatch'; end if;
 return jsonb_build_object('valid',true);
end $$;
revoke all on function public.membership_discord_check(uuid,text) from public,anon,authenticated;
grant execute on function public.membership_discord_check(uuid,text) to service_role;

revoke all on function public.membership_notify(uuid,boolean),public.membership_admit(uuid,boolean),public.membership_oauth_admission() from public,anon,authenticated,service_role;
