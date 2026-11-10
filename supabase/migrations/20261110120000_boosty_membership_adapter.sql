begin;

-- Boosty membership adapter: DM link codes, the creator credential in Supabase Vault, the
-- subscriber poll's durable state, and Boosty's arm of the provider identity lookup that the
-- generic fence (20261109140000_membership_funding_providers.sql) reads. Identifiers are
-- checked by that migration's membership_provider_identifier_valid, never a local pattern.
-- Boosty's API is unofficial; every write here treats a failed or partial read as "no
-- evidence", never as loss. Service role only; browser roles have no access.
create schema boosty_membership;
revoke all on schema boosty_membership from public, anon, authenticated, service_role;

-- Worker lease, pinned blog, poll schedule, circuit-breaker baseline and dispatch state.
create table boosty_membership.sync_state (
 singleton boolean primary key default true check (singleton),
 blog text check (public.membership_provider_identifier_valid('boosty','program',blog)),
 worker_token uuid,
 worker_until timestamptz,
 next_poll_at timestamptz not null default '-infinity',
 last_poll_at timestamptz,
 last_complete_poll_at timestamptz,
 last_complete_count integer check (last_complete_count >= 0),
 breaker_tripped_at timestamptz,
 breaker_alerted_at timestamptz,
 dispatch_enabled boolean not null default false,
 dispatch_until timestamptz,
 dispatch_request_id bigint,
 dispatch_error text check (dispatch_error in ('dispatch_unavailable'))
);
insert into boosty_membership.sync_state default values;

-- The authoritative account <-> Boosty user binding, like public.patreon_accounts.
create table boosty_membership.links (
 account_id uuid primary key references auth.users(id) on delete cascade,
 boosty_user_id text not null unique check (public.membership_provider_identifier_valid('boosty','user',boosty_user_id)),
 linked_at timestamptz not null default clock_timestamp()
);

-- One link code per account: only its SHA-256 is stored. A code is pending while outcome
-- is null and it has not expired. The window columns bound issuance per account.
create table boosty_membership.link_codes (
 account_id uuid primary key references auth.users(id) on delete cascade,
 code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
 issued_at timestamptz not null,
 expires_at timestamptz not null,
 expected_generation bigint not null check (expected_generation >= 0),
 outcome text check (outcome in ('linked','conflict','superseded')),
 window_started_at timestamptz not null,
 issue_count integer not null check (issue_count between 1 and 5),
 check (expires_at > issued_at)
);
create unique index boosty_link_codes_pending_hash on boosty_membership.link_codes(code_hash) where outcome is null;

-- Highest processed message per Boosty dialog, so each message is matched at most once.
create table boosty_membership.dialog_cursors (
 dialog_id bigint primary key check (dialog_id > 0),
 last_message_id bigint not null check (last_message_id >= 0),
 updated_at timestamptz not null default clock_timestamp()
);

-- First complete poll that did not list a linked subscriber; cleared when listed again.
create table boosty_membership.absences (
 account_id uuid primary key references auth.users(id) on delete cascade,
 boosty_user_id text not null check (public.membership_provider_identifier_valid('boosty','user',boosty_user_id)),
 absent_since timestamptz not null
);

-- Vault-held creator credential: device id, rotating refresh token and current access token.
create table boosty_membership.creator_credential (
 singleton boolean primary key default true check (singleton),
 generation bigint not null default 0 check (generation >= 0),
 device_secret_id uuid,
 refresh_secret_id uuid,
 access_secret_id uuid,
 expires_at timestamptz,
 refreshed_at timestamptz,
 last_failure text check (last_failure in ('rejected','unavailable')),
 last_failure_at timestamptz,
 alerted_at timestamptz,
 check ((device_secret_id is null) = (refresh_secret_id is null)),
 check ((generation = 0) = (refresh_secret_id is null))
);

alter table boosty_membership.sync_state enable row level security;
alter table boosty_membership.links enable row level security;
alter table boosty_membership.link_codes enable row level security;
alter table boosty_membership.dialog_cursors enable row level security;
alter table boosty_membership.absences enable row level security;
alter table boosty_membership.creator_credential enable row level security;
revoke all on all tables in schema boosty_membership from public, anon, authenticated, service_role;

-- The provider registry's identity lookup, re-created with every adapter's branch: the account's
-- current binding for one provider, or null when unlinked. The generic membership_provider_fence
-- calls it under the account lock. A later provider's migration re-creates it with Boosty's branch
-- and its own; a provider without a branch is refused, never read as unlinked. CREATE OR REPLACE
-- keeps the provider migration's revoked privileges.
create or replace function public.membership_provider_identity(p_account_id uuid, p_provider text) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
 case p_provider
  when 'boosty' then return (select boosty_user_id from boosty_membership.links where account_id=p_account_id);
  else raise exception 'Invalid funding provider';
 end case;
end $$;

-- Website account status for Boosty: the fenced head plus the account's link-code state.
-- p_code_hash (the browser's code, hashed by the Edge) only reports whether it is the pending one.
create function public.boosty_link_status(p_account_id uuid, p_discord_user_id text, p_code_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare snapshot jsonb; c boosty_membership.link_codes; pending boolean;
begin
 perform set_config('lock_timeout',public.membership_lock_budget(),true);
 if p_code_hash is not null and p_code_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid link code'; end if;
 snapshot := public.membership_provider_fence(p_account_id,'boosty',p_discord_user_id,false);
 select * into c from boosty_membership.link_codes where account_id=p_account_id;
 pending := c.account_id is not null and c.outcome is null and c.expires_at > clock_timestamp();
 return jsonb_build_object('snapshot',snapshot,
  'pending',case when pending then jsonb_build_object('expiresAt',to_char(c.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'matches',c.code_hash=p_code_hash) else null end,
  'outcome',case when c.outcome in ('conflict','superseded') then c.outcome end);
end $$;

-- Issues a 30-minute link code for an unlinked live account. A new code replaces the pending
-- one; at most 5 codes per account per hour. Only the code's hash reaches the database.
create function public.boosty_link_begin(p_account_id uuid, p_discord_user_id text, p_code_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare snapshot jsonb; c boosty_membership.link_codes; now_at timestamptz := clock_timestamp(); expires timestamptz;
begin
 perform set_config('lock_timeout',public.membership_lock_budget(),true);
 if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid link code'; end if;
 snapshot := public.membership_provider_fence(p_account_id,'boosty',p_discord_user_id,false);
 if snapshot->>'linkState' <> 'unlinked' or exists(select 1 from boosty_membership.links where account_id=p_account_id) then
  raise exception 'Boosty account already linked';
 end if;
 select * into c from boosty_membership.link_codes where account_id=p_account_id for update;
 if found and c.window_started_at > now_at - interval '1 hour' and c.issue_count >= 5 then
  raise sqlstate 'PT429' using message='membership_rate_limited';
 end if;
 expires := now_at + interval '30 minutes';
 insert into boosty_membership.link_codes(account_id,code_hash,issued_at,expires_at,expected_generation,outcome,window_started_at,issue_count)
  values(p_account_id,p_code_hash,now_at,expires,(snapshot->>'linkGeneration')::bigint,null,now_at,1)
  on conflict(account_id) do update set code_hash=excluded.code_hash, issued_at=excluded.issued_at, expires_at=excluded.expires_at,
   expected_generation=excluded.expected_generation, outcome=null,
   window_started_at=case when boosty_membership.link_codes.window_started_at > now_at - interval '1 hour' then boosty_membership.link_codes.window_started_at else now_at end,
   issue_count=case when boosty_membership.link_codes.window_started_at > now_at - interval '1 hour' then boosty_membership.link_codes.issue_count + 1 else 1 end;
 return jsonb_build_object('expiresAt',to_char(expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

-- Owner unlink: drops the binding and any pending code, then fences the head to unlinked.
create function public.boosty_unlink(p_account_id uuid, p_discord_user_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 perform set_config('lock_timeout',public.membership_lock_budget(),true);
 if not pg_try_advisory_xact_lock(hashtextextended(p_account_id::text, 702)) then raise sqlstate '55P03' using message='membership_retry'; end if;
 delete from boosty_membership.link_codes where account_id=p_account_id;
 delete from boosty_membership.absences where account_id=p_account_id;
 delete from boosty_membership.links where account_id=p_account_id;
 return public.membership_provider_fence(p_account_id,'boosty',p_discord_user_id,false);
end $$;

-- Refuses a worker call whose lease is not the current, live one.
create function boosty_membership.require_lease(p_token uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if p_token is null or not exists(select 1 from boosty_membership.sync_state where singleton and worker_token=p_token and worker_until>clock_timestamp()) then
  raise exception 'stale_boosty_lease';
 end if;
end $$;

-- Starts one bounded worker run: a two-minute lease, the pinned blog, and whether a poll is due.
create function boosty_membership.acquire(p_input jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s boosty_membership.sync_state; token uuid := gen_random_uuid();
begin
 if p_input->>'blog' is null or not public.membership_provider_identifier_valid('boosty','program',p_input->>'blog') then raise exception 'invalid_boosty_blog'; end if;
 -- A concurrent acquirer holds the row: that run owns the lease, so this one is already running.
 select * into s from boosty_membership.sync_state where singleton for update skip locked;
 if not found then return null; end if;
 if s.blog is not null and s.blog <> p_input->>'blog' then raise exception 'boosty_blog_mismatch'; end if;
 if s.worker_until > clock_timestamp() then return null; end if;
 update boosty_membership.sync_state set blog=p_input->>'blog', worker_token=token, worker_until=clock_timestamp()+interval '2 minutes' where singleton returning * into s;
 return jsonb_build_object('token',token,'pollDue',s.next_poll_at<=clock_timestamp(),'lastCompleteCount',s.last_complete_count,
  'now',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

-- Returns the dialogs that may hold unprocessed messages. A dialog whose newest message is over
-- an hour old cannot carry a live code, so its cursor advances without a read.
create function boosty_membership.dialogs(p_input jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d record; due jsonb := '[]'::jsonb; cursor_id bigint;
begin
 if jsonb_typeof(p_input->'dialogs') <> 'array' or jsonb_array_length(p_input->'dialogs') > 100 then raise exception 'invalid_boosty_dialogs'; end if;
 for d in select * from jsonb_to_recordset(p_input->'dialogs') as x("dialogId" bigint, "lastMessageId" bigint, "lastMessageAt" timestamptz) loop
  if d."dialogId" is null or d."dialogId" < 1 or d."lastMessageId" is null or d."lastMessageId" < 1 then raise exception 'invalid_boosty_dialog'; end if;
  select last_message_id into cursor_id from boosty_membership.dialog_cursors where dialog_id=d."dialogId";
  if cursor_id is not null and cursor_id >= d."lastMessageId" then continue; end if;
  if d."lastMessageAt" is not null and d."lastMessageAt" < clock_timestamp() - interval '1 hour' then
   insert into boosty_membership.dialog_cursors(dialog_id,last_message_id) values(d."dialogId",d."lastMessageId")
    on conflict(dialog_id) do update set last_message_id=greatest(boosty_membership.dialog_cursors.last_message_id,excluded.last_message_id),updated_at=clock_timestamp();
   continue;
  end if;
  due := due || jsonb_build_array(jsonb_build_object('dialogId',d."dialogId",'cursor',coalesce(cursor_id,0)));
 end loop;
 return jsonb_build_object('due',due);
end $$;

-- Applies code matches from one dialog and advances its cursor. Only an exact pending code
-- links; a Boosty user bound to another account is refused (the owner must unlink there).
create function boosty_membership.link(p_input jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m record; c boosty_membership.link_codes; h public.membership_provider_heads; generation bigint;
 linked integer := 0; refused integer := 0; dialog bigint := (p_input->>'dialogId')::bigint; through bigint := (p_input->>'cursor')::bigint;
begin
 if dialog is null or dialog < 1 or through is null or through < 1 or jsonb_typeof(p_input->'matches') <> 'array' or jsonb_array_length(p_input->'matches') > 20 then
  raise exception 'invalid_boosty_matches';
 end if;
 for m in select * from jsonb_to_recordset(p_input->'matches') as x("messageId" bigint, "boostyUserId" text, "codeHash" text, "messageAt" timestamptz) loop
  if m."messageId" is null or m."messageId" < 1 or m."messageId" > through or not public.membership_provider_identifier_valid('boosty','user',m."boostyUserId") or m."codeHash" !~ '^[a-f0-9]{64}$' then
   raise exception 'invalid_boosty_match';
  end if;
  select * into c from boosty_membership.link_codes where code_hash=m."codeHash" and outcome is null for update;
  if not found then continue; end if;
  -- Live now, or sent while live and processed within an hour of expiry.
  if not (c.expires_at > clock_timestamp() or (m."messageAt" is not null and m."messageAt" between c.issued_at and c.expires_at
    and clock_timestamp() < c.expires_at + interval '1 hour')) then continue; end if;
  if not pg_try_advisory_xact_lock(hashtextextended(c.account_id::text, 702)) then raise sqlstate '55P03' using message='membership_retry'; end if;
  select * into h from public.membership_provider_heads where account_id=c.account_id and provider='boosty' for update;
  generation := coalesce(h.link_generation,0);
  if exists(select 1 from boosty_membership.links where account_id=c.account_id) or generation <> c.expected_generation
   or h.link_state = 'account_deleted' then
   update boosty_membership.link_codes set outcome='superseded' where account_id=c.account_id; refused := refused + 1; continue;
  end if;
  if exists(select 1 from boosty_membership.links where boosty_user_id=m."boostyUserId") then
   update boosty_membership.link_codes set outcome='conflict' where account_id=c.account_id; refused := refused + 1; continue;
  end if;
  insert into boosty_membership.links(account_id,boosty_user_id) values(c.account_id,m."boostyUserId");
  delete from boosty_membership.absences where account_id=c.account_id;
  if h.account_id is null then
   insert into public.membership_heads(account_id) values(c.account_id) on conflict do nothing;
   insert into public.membership_provider_heads(account_id,provider,evidence)
    values(c.account_id,'boosty',public.membership_provider_empty_evidence('boosty')) returning * into h;
  end if;
  -- Evidence starts unknown; the next subscriber poll (scheduled now) decides it.
  update public.membership_provider_heads set provider_user_id=m."boostyUserId", link_state='linked',
   link_generation=link_generation+1, revision=revision+1,
   evidence=public.membership_provider_empty_evidence('boosty') || '{"verification":"unknown"}'::jsonb
   where account_id=c.account_id and provider='boosty';
  perform public.membership_notify_provider(c.account_id,'boosty',true);
  update boosty_membership.link_codes set outcome='linked' where account_id=c.account_id;
  update boosty_membership.sync_state set next_poll_at=clock_timestamp() where singleton;
  linked := linked + 1;
 end loop;
 insert into boosty_membership.dialog_cursors(dialog_id,last_message_id) values(dialog,through)
  on conflict(dialog_id) do update set last_message_id=greatest(boosty_membership.dialog_cursors.last_message_id,excluded.last_message_id),updated_at=clock_timestamp();
 return jsonb_build_object('linked',linked,'refused',refused);
end $$;

-- Linked heads the subscriber poll must decide, with their absence state. Bounded to 5001
-- rows so the worker can refuse an over-cap set instead of deciding part of it.
create function boosty_membership.linked(p_input jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(jsonb_build_object('accountId',h.account_id,'providerUserId',h.provider_user_id,'linkGeneration',h.link_generation::text,
  'absentSince',case when a.boosty_user_id=h.provider_user_id then to_char(a.absent_since at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end) order by h.account_id),'[]'::jsonb)
 from (select * from public.membership_provider_heads where provider='boosty' and link_state='linked' and provider_user_id is not null order by account_id limit 5001) h
 left join boosty_membership.absences a on a.account_id=h.account_id
$$;

-- Validates one Boosty evidence object in the version 2 vocabulary for the pinned blog.
create function boosty_membership.valid_evidence(e jsonb, p_blog text) returns boolean
language sql immutable set search_path = '' as $$
 select jsonb_typeof(e)='object'
  and (select count(*) from jsonb_object_keys(e)) = case when e ? 'paidAccessEndedAt' then 9 else 8 end
  and e ?& array['verification','programId','memberId','tierIds','verifiedAt','paidThroughAt','policyVersion','evidenceSha256']
  and e->>'verification' in ('qualifying','nonqualifying','unknown','review_required')
  and e->>'programId' is not distinct from p_blog and e->'memberId'='null'::jsonb and e->'paidThroughAt'='null'::jsonb
  and e->>'policyVersion'=any(public.membership_provider_policy_versions('boosty'))
  and jsonb_typeof(e->'tierIds')='array' and jsonb_array_length(e->'tierIds') <= 1
  and not exists(select 1 from jsonb_array_elements(e->'tierIds') t where jsonb_typeof(t)<>'string' or not public.membership_provider_identifier_valid('boosty','tier',t#>>'{}'))
  and jsonb_typeof(e->'verifiedAt')='string' and e->>'verifiedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
  and jsonb_typeof(e->'evidenceSha256')='string' and e->>'evidenceSha256' ~ '^[a-f0-9]{64}$'
  and (e->>'verification'<>'qualifying' or jsonb_array_length(e->'tierIds')=1)
  and (not e ? 'paidAccessEndedAt' or (e->>'verification'='nonqualifying' and e->'tierIds'='[]'::jsonb
   and e->'paidAccessEndedAt'=e->'verifiedAt'))
$$;

-- Writes decided evidence for linked heads after a complete poll. A head whose link changed
-- since the poll read it is skipped. Absence state is recorded with the evidence.
create function boosty_membership.write_evidence(p_input jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; blog text; written integer := 0;
begin
 select s.blog into strict blog from boosty_membership.sync_state s where singleton;
 if jsonb_typeof(p_input->'results') <> 'array' or jsonb_array_length(p_input->'results') > 200 then raise exception 'invalid_boosty_results'; end if;
 for r in select * from jsonb_to_recordset(p_input->'results') as x("accountId" uuid, "providerUserId" text, "linkGeneration" bigint, evidence jsonb, "absentSince" timestamptz) loop
  if r."accountId" is null or not public.membership_provider_identifier_valid('boosty','user',r."providerUserId") or r."linkGeneration" is null or not boosty_membership.valid_evidence(r.evidence, blog) then
   raise exception 'invalid_boosty_result';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended(r."accountId"::text, 702)) then continue; end if; -- a busy account keeps its evidence until the next poll
  update public.membership_provider_heads set evidence=r.evidence, revision=revision+1
   where account_id=r."accountId" and provider='boosty' and link_state='linked'
    and provider_user_id=r."providerUserId" and link_generation=r."linkGeneration";
  if not found then continue; end if;
  if r."absentSince" is null then delete from boosty_membership.absences where account_id=r."accountId";
  else
   insert into boosty_membership.absences(account_id,boosty_user_id,absent_since) values(r."accountId",r."providerUserId",r."absentSince")
    on conflict(account_id) do update set boosty_user_id=excluded.boosty_user_id, absent_since=excluded.absent_since;
  end if;
  -- Revocation-class delivery never raises, so one busy account cannot fail the batch.
  perform public.membership_notify_provider(r."accountId",'boosty',true);
  written := written + 1;
 end loop;
 return jsonb_build_object('written',written);
end $$;

-- After a failed, partial or breaker-tripped poll: only evidence older than 24 hours becomes
-- unknown. Never writes loss. Bounded to 500 heads per call.
create function boosty_membership.stale(p_input jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h record; blog text; marked integer := 0;
begin
 select s.blog into blog from boosty_membership.sync_state s where singleton;
 for h in select account_id from public.membership_provider_heads
  where provider='boosty' and link_state='linked' and evidence->>'verification' <> 'unknown'
   and (evidence->>'verifiedAt' is null or (evidence->>'verifiedAt')::timestamptz < clock_timestamp() - interval '24 hours')
  order by account_id limit 500 loop
  if not pg_try_advisory_xact_lock(hashtextextended(h.account_id::text, 702)) then continue; end if;
  update public.membership_provider_heads set revision=revision+1,
   evidence=public.membership_provider_empty_evidence('boosty') || jsonb_build_object('verification','unknown','programId',blog)
   where account_id=h.account_id and provider='boosty';
  perform public.membership_notify_provider(h.account_id,'boosty',true);
  marked := marked + 1;
 end loop;
 return jsonb_build_object('marked',marked);
end $$;

-- Records a poll attempt. Only a complete, untripped poll moves the breaker baseline; a trip
-- holds it until an operator clears last_complete_count. Answers whether to alert now.
create function boosty_membership.polled(p_input jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare complete boolean := (p_input->>'complete')::boolean; tripped boolean := (p_input->>'tripped')::boolean;
 total integer := (p_input->>'total')::integer; alert boolean := false; s boosty_membership.sync_state;
begin
 if complete is null or tripped is null or (complete and not tripped and (total is null or total < 0)) then raise exception 'invalid_boosty_poll'; end if;
 select * into strict s from boosty_membership.sync_state where singleton for update;
 if complete and not tripped then
  update boosty_membership.sync_state set last_poll_at=clock_timestamp(), last_complete_poll_at=clock_timestamp(), last_complete_count=total,
   breaker_tripped_at=null, next_poll_at=clock_timestamp()+interval '30 minutes' where singleton;
 else
  alert := tripped and (s.breaker_alerted_at is null or s.breaker_alerted_at < clock_timestamp() - interval '6 hours');
  update boosty_membership.sync_state set last_poll_at=clock_timestamp(), next_poll_at=clock_timestamp()+interval '30 minutes',
   breaker_tripped_at=case when tripped then clock_timestamp() else breaker_tripped_at end,
   breaker_alerted_at=case when alert then clock_timestamp() else breaker_alerted_at end where singleton;
 end if;
 return jsonb_build_object('alert',alert);
end $$;

-- Ends the run's lease so the next dispatch can start.
create function boosty_membership.release(p_input jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 update boosty_membership.sync_state set worker_token=null, worker_until=null where singleton and worker_token=(p_input->>'token')::uuid;
 return jsonb_build_object('released',found);
end $$;

-- The worker's only database entry point: a closed operation set, every call but acquire
-- fenced by the current lease. Service role only.
create function public.boosty_membership_sync(p_operation text, p_input jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 perform set_config('lock_timeout',public.membership_lock_budget(),true);
 if p_input is null or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 262144 then raise exception 'invalid_boosty_request'; end if;
 if p_operation = 'acquire' then return boosty_membership.acquire(p_input); end if;
 if p_operation not in ('dialogs','link','linked','evidence','stale','polled','release') then raise exception 'invalid_boosty_operation'; end if;
 if p_operation = 'release' then return boosty_membership.release(p_input); end if;
 perform boosty_membership.require_lease((p_input->>'token')::uuid);
 return case p_operation
  when 'dialogs' then boosty_membership.dialogs(p_input)
  when 'link' then boosty_membership.link(p_input)
  when 'linked' then boosty_membership.linked(p_input)
  when 'evidence' then boosty_membership.write_evidence(p_input)
  when 'stale' then boosty_membership.stale(p_input)
  else boosty_membership.polled(p_input) end;
end $$;

-- Boosty creator credential rotation, like public.patreon_creator_token. Boosty consumes the
-- refresh token on every refresh, so a rotated pair is stored before the new access token is used.
create function public.boosty_creator_credential(p_operation text, p_input jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r boosty_membership.creator_credential; v_device text; v_refresh text; v_access text; v_generation bigint; v_expires bigint; v_reason text; v_alert boolean;
begin
 if p_input is null or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 16384
  or p_operation is null or p_operation not in ('read','seed','rotate','failed') then raise exception 'invalid_boosty_credential_request'; end if;
 perform set_config('lock_timeout','2000',true);
 if p_operation = 'read' then
  select * into r from boosty_membership.creator_credential where singleton;
  if r.refresh_secret_id is null then return jsonb_build_object('configured',false,'generation',0); end if;
  select decrypted_secret into strict v_device from vault.decrypted_secrets where id=r.device_secret_id;
  select decrypted_secret into strict v_refresh from vault.decrypted_secrets where id=r.refresh_secret_id;
  if r.access_secret_id is not null then select decrypted_secret into strict v_access from vault.decrypted_secrets where id=r.access_secret_id; end if;
  return jsonb_build_object('configured',true,'deviceId',v_device,'refreshToken',v_refresh,'accessToken',v_access,'generation',r.generation,
   'refreshDue',v_access is null or r.expires_at is null or r.expires_at <= now() + interval '12 hours');
 end if;
 insert into boosty_membership.creator_credential(singleton) values(true) on conflict do nothing;
 select * into r from boosty_membership.creator_credential where singleton for update;
 if p_operation = 'seed' then
  v_device := p_input->>'deviceId'; v_refresh := p_input->>'refreshToken';
  if v_device is null or v_device !~ '^[A-Za-z0-9_-]{8,128}$' or v_refresh is null or length(v_refresh) not between 16 and 4096 or v_refresh !~ '^[!-~]+$' then raise exception 'invalid_boosty_credential'; end if;
  if r.generation > 0 then return jsonb_build_object('stale',true,'generation',r.generation); end if;
  update boosty_membership.creator_credential set
   device_secret_id=vault.create_secret(v_device,'boosty_creator_device_id','Boosty creator device id for the boosty-membership worker'),
   refresh_secret_id=vault.create_secret(v_refresh,'boosty_creator_refresh_token','Boosty creator refresh token; rotated by the boosty-membership worker'),
   generation=1 where singleton;
  return jsonb_build_object('seeded',true,'generation',1);
 end if;
 v_generation := (p_input->>'generation')::bigint;
 if v_generation is null or v_generation < 1 then raise exception 'invalid_boosty_credential_generation'; end if;
 if r.refresh_secret_id is null then return jsonb_build_object('configured',false,'generation',0); end if;
 if r.generation <> v_generation then return jsonb_build_object('stale',true,'generation',r.generation); end if;
 if p_operation = 'failed' then
  v_reason := p_input->>'reason';
  if v_reason is null or v_reason not in ('rejected','unavailable') then raise exception 'invalid_boosty_credential_failure'; end if;
  v_alert := r.alerted_at is null or r.alerted_at < now() - interval '6 hours';
  update boosty_membership.creator_credential set last_failure=v_reason, last_failure_at=now(),
   alerted_at=case when v_alert then now() else alerted_at end where singleton;
  return jsonb_build_object('recorded',true,'alert',v_alert);
 end if;
 v_access := p_input->>'accessToken'; v_refresh := p_input->>'refreshToken';
 v_expires := case when jsonb_typeof(p_input->'expiresIn')='number' then (p_input->>'expiresIn')::bigint end;
 if v_access is null or length(v_access) not between 16 and 4096 or v_access !~ '^[!-~]+$'
  or v_refresh is null or length(v_refresh) not between 16 and 4096 or v_refresh !~ '^[!-~]+$' or v_access=v_refresh
  or v_expires is null or v_expires < 60 or v_expires > 366*86400 then raise exception 'invalid_boosty_credential'; end if;
 perform vault.update_secret(r.refresh_secret_id, v_refresh);
 if r.access_secret_id is null then
  update boosty_membership.creator_credential set access_secret_id=vault.create_secret(v_access,'boosty_creator_access_token','Boosty creator access token; rotated by the boosty-membership worker') where singleton;
 else perform vault.update_secret(r.access_secret_id, v_access);
 end if;
 update boosty_membership.creator_credential set generation=v_generation+1, expires_at=now()+make_interval(secs => v_expires), refreshed_at=now(),
  last_failure=null, last_failure_at=null, alerted_at=null where singleton;
 return jsonb_build_object('rotated',true,'generation',v_generation+1);
end $$;

-- pg_cron entry point: posts one authenticated worker wakeup through pg_net when dispatch is
-- enabled and no run is live. Never raises or logs Vault values; records a fixed error instead.
create function boosty_membership.dispatch() returns bigint
language plpgsql security definer set search_path = '' as $function$
declare s boosty_membership.sync_state; v_url text; v_key text; v_request bigint;
begin
 select * into s from boosty_membership.sync_state where singleton for update skip locked;
 if not found or not s.dispatch_enabled or s.worker_until > now() or s.dispatch_until > now() then return null; end if;
 begin
  select decrypted_secret into strict v_url from vault.decrypted_secrets where name='boosty_membership_function_url';
  select decrypted_secret into strict v_key from vault.decrypted_secrets where name='boosty_membership_sync_secret';
  if v_url is null or v_key is null or v_url !~ '^https://[a-z]{20}\.supabase\.co/functions/v1/boosty-membership$'
   or length(v_key) not between 16 and 4096 or v_key ~ E'[\r\n]' then raise exception 'invalid_dispatch_configuration'; end if;
  select net.http_post(url := v_url, headers := jsonb_build_object('Content-Type','application/json','X-Boosty-Sync-Key',v_key),
   body := '{}'::jsonb, timeout_milliseconds := 60000) into v_request;
  if v_request is null then raise exception 'missing_dispatch_receipt'; end if;
  update boosty_membership.sync_state set dispatch_until=now()+interval '2 minutes', dispatch_request_id=v_request, dispatch_error=null where singleton;
  return v_request;
 exception when others then
  update boosty_membership.sync_state set dispatch_error='dispatch_unavailable' where singleton;
  return null;
 end;
end $function$;

revoke all on all functions in schema boosty_membership from public, anon, authenticated, service_role;
revoke all on function public.boosty_link_status(uuid,text,text), public.boosty_link_begin(uuid,text,text), public.boosty_unlink(uuid,text),
 public.boosty_membership_sync(text,jsonb), public.boosty_creator_credential(text,jsonb) from public, anon, authenticated;
grant execute on function public.boosty_link_status(uuid,text,text), public.boosty_link_begin(uuid,text,text), public.boosty_unlink(uuid,text),
 public.boosty_membership_sync(text,jsonb), public.boosty_creator_credential(text,jsonb) to service_role;

commit;
