begin;

-- Provider-scoped membership for the control plane's version 2 snapshot and version 3
-- claim contract. public.membership_heads stays the Patreon head and the account
-- anchor that Discord linking, completion receipts and the outbox reference, so every
-- deployed Patreon and Discord RPC keeps its exact behavior. Other funding providers
-- get their own head table keyed by (account_id, provider). No linking adapter exists
-- for them yet: their heads are created only as account-deletion tombstones.
create table public.membership_provider_heads (
 account_id uuid not null references public.membership_heads(account_id),
 provider text not null check (provider in ('boosty')),
 discord_user_id text check (discord_user_id ~ '^[0-9]{17,20}$'),
 -- Boosty user IDs; a provider added later widens this grammar in its own migration.
 provider_user_id text check (provider_user_id ~ '^[1-9][0-9]{0,19}$'),
 link_generation bigint not null default 0 check (link_generation >= 0),
 revision bigint not null default 0 check (revision >= 0),
 link_state text not null default 'unlinked' check (link_state in ('linked','unlinked','identity_changed','account_deleted')),
 evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
 primary key (account_id, provider),
 unique (provider, provider_user_id)
);
alter table public.membership_provider_heads enable row level security;
revoke all on public.membership_provider_heads from public, anon, authenticated, service_role;

-- Every hint names the provider whose head changed. Existing rows are Patreon hints;
-- revisions are per provider head, so uniqueness moves to (account, provider, revision).
alter table public.membership_outbox
 add column provider text not null default 'patreon',
 add constraint membership_outbox_provider check (provider in ('patreon','boosty'));
alter table public.membership_outbox add constraint membership_outbox_account_provider_revision unique (account_id, provider, revision);
alter table public.membership_outbox drop constraint membership_outbox_account_id_revision_key;

-- Empty evidence in the version 2 vocabulary for a non-Patreon provider; NULL for an unknown one.
create function public.membership_provider_empty_evidence(p_provider text) returns jsonb
language sql immutable set search_path = '' as $$
 select case p_provider when 'boosty' then '{"verification":"unverified","programId":null,"memberId":null,"tierIds":[],"verifiedAt":null,"paidThroughAt":null,"policyVersion":"boosty-paid-v1","evidenceSha256":null}'::jsonb end
$$;

-- Version 2 snapshot of one non-Patreon provider head.
create function public.membership_provider_snapshot_json(h public.membership_provider_heads) returns jsonb
language sql stable set search_path = '' as $$
 select jsonb_build_object('version',2,'provider',h.provider,'accountId',h.account_id,'discordUserId',h.discord_user_id,'providerUserId',h.provider_user_id,'linkGeneration',h.link_generation::text,'revision',h.revision::text,'linkState',h.link_state) || h.evidence
$$;

-- Records a hint for one provider head's current revision under that provider's own
-- 8 ordinary + 1 reserved revocation bound, so no provider starves another's revocation.
create function public.membership_notify_provider(p_account_id uuid, p_provider text, p_revocation boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare current_revision bigint; pending_count integer;
begin
 perform set_config('lock_timeout',public.membership_lock_budget(),true);
 if p_provider = 'patreon' then
  select revision into strict current_revision from public.membership_heads where account_id=p_account_id;
 else
  select revision into strict current_revision from public.membership_provider_heads where account_id=p_account_id and provider=p_provider;
 end if;
 if exists(select 1 from public.membership_outbox where account_id=p_account_id and provider=p_provider and revision=current_revision) then return; end if;
 select count(*) into pending_count from public.membership_outbox where account_id=p_account_id and provider=p_provider and receipt_id is null;
 if pending_count >= (case when p_revocation then 9 else 8 end) then
  if p_revocation then return; end if; -- surviving hints durably wake ack repair
  raise sqlstate 'PT429' using message='membership_rate_limited';
 end if;
 insert into public.membership_outbox(account_id,provider,revision) values(p_account_id,p_provider,current_revision);
end $$;

-- Every existing Patreon writer keeps calling this signature; it notifies the Patreon head.
create or replace function public.membership_notify(p_account_id uuid, p_revocation boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
 perform public.membership_notify_provider(p_account_id,'patreon',p_revocation);
end $$;

-- Caller MUST first read the exact account via Auth admin API. Fences one non-Patreon
-- head with the same account lock, tombstone and Discord rules as membership_fence.
create function public.membership_provider_fence(p_account_id uuid, p_provider text, p_discord_user_id text, p_deleted boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h public.membership_provider_heads; state text;
begin
 perform set_config('lock_timeout',public.membership_lock_budget(),true);
 if p_provider is distinct from 'boosty' then raise exception 'Invalid funding provider'; end if;
 if not pg_try_advisory_xact_lock(hashtextextended(p_account_id::text, 702)) then raise sqlstate '55P03' using message='membership_retry'; end if;
 select * into h from public.membership_provider_heads where account_id=p_account_id and provider=p_provider for update;
 if not found then
  -- A live account without a head never bound this provider: a constant generation-0 answer, no writes.
  if not coalesce(p_deleted,false) then
   h.account_id := p_account_id; h.provider := p_provider; h.link_generation := 0; h.revision := 0;
   h.link_state := 'unlinked'; h.evidence := public.membership_provider_empty_evidence(p_provider);
   return public.membership_provider_snapshot_json(h);
  end if;
  -- A tombstone needs the account anchor that membership_outbox references.
  insert into public.membership_heads(account_id) values(p_account_id) on conflict do nothing;
  insert into public.membership_provider_heads(account_id,provider,evidence)
   values(p_account_id,p_provider,public.membership_provider_empty_evidence(p_provider)) returning * into h;
 end if;
 if p_deleted then state := 'account_deleted';
 else
  if h.link_state='account_deleted' then raise exception 'Deleted account cannot be resurrected'; end if;
  -- No linking adapter exists yet, so no account currently binds this provider.
  state := 'unlinked';
 end if;
 if h.provider_user_id is not null or h.link_state is distinct from state then
  update public.membership_provider_heads set discord_user_id=case when p_deleted then null else p_discord_user_id end, provider_user_id=null,
   link_generation=link_generation+1, revision=revision+1, link_state=state, evidence=public.membership_provider_empty_evidence(p_provider)
   where account_id=p_account_id and provider=p_provider returning * into h;
  perform public.membership_notify_provider(p_account_id,p_provider,true);
 elsif h.discord_user_id is distinct from p_discord_user_id then
  -- Optional profile metadata changes never invalidate paid membership evidence.
  update public.membership_provider_heads set discord_user_id=p_discord_user_id, revision=revision+1
   where account_id=p_account_id and provider=p_provider returning * into h;
  perform public.membership_notify_provider(p_account_id,p_provider,false);
 end if;
 return public.membership_provider_snapshot_json(h);
end $$;

-- Version 2 snapshot of one provider. Patreon is exactly membership_fence's version 1
-- evidence with patreonUserId/campaignId renamed to providerUserId/programId.
create function public.membership_funding_fence(p_account_id uuid, p_provider text, p_discord_user_id text, p_deleted boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare snapshot jsonb;
begin
 perform set_config('lock_timeout',public.membership_lock_budget(),true);
 if p_provider is distinct from 'patreon' then return public.membership_provider_fence(p_account_id,p_provider,p_discord_user_id,p_deleted); end if;
 snapshot := public.membership_fence(p_account_id,p_discord_user_id,p_deleted);
 return (snapshot - 'version' - 'patreonUserId' - 'campaignId')
  || jsonb_build_object('version',2,'provider','patreon','providerUserId',snapshot->'patreonUserId','programId',snapshot->'campaignId');
end $$;

-- Version 3 claim: exactly membership_claim's lease and rows, each event naming its provider.
create function public.membership_funding_claim(p_claim_id uuid, p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare page jsonb;
begin
 perform set_config('lock_timeout',public.membership_lock_budget(),true);
 page := public.membership_claim(p_claim_id,p_limit);
 if page ? 'retry' then return page; end if;
 return jsonb_set(page,'{version}','3') || jsonb_build_object('events',coalesce((
  select jsonb_agg(event || jsonb_build_object('provider',outbox.provider) order by ordinal)
  from jsonb_array_elements(page->'events') with ordinality as e(event,ordinal)
  join public.membership_outbox outbox on outbox.event_id=(event->>'eventId')::uuid),'[]'::jsonb));
end $$;

-- Auth deletion tombstones the Patreon head (as before) and every existing provider head.
create or replace function public.membership_auth_deleted() returns trigger language plpgsql security definer set search_path = '' as $$
declare head_provider text;
begin
 perform set_config('lock_timeout',public.membership_lock_budget(),true);
 perform public.membership_fence(old.id,null,true);
 for head_provider in select provider from public.membership_provider_heads where account_id=old.id order by provider loop
  perform public.membership_provider_fence(old.id,head_provider,null,true);
 end loop;
 return old;
end $$;

-- Acknowledgements repair the newest head of the acknowledged hint's own provider.
create or replace function public.membership_ack(
    p_event_id uuid,p_receipt_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare outbox public.membership_outbox; account uuid;
begin
    perform set_config('lock_timeout',public.membership_lock_budget(),true);
    select account_id into account from public.membership_outbox where event_id=p_event_id;
    if not found then raise exception 'Receipt conflict'; end if;
    if not pg_try_advisory_xact_lock(hashtextextended(account::text,702)) then
        return jsonb_build_object('version',1,'retry',true);
    end if;
    select * into outbox from public.membership_outbox
        where event_id=p_event_id for update;
    if not found then raise exception 'Receipt conflict'; end if;
    if outbox.receipt_id is not null then
        if outbox.receipt_id<>p_receipt_id then raise exception 'Receipt conflict'; end if;
        return jsonb_build_object('version',1,'acknowledged',true,
            'eventId',p_event_id,'receiptId',p_receipt_id);
    end if;
    if outbox.claim_id is not null and outbox.claim_expires_at>clock_timestamp() then
        return jsonb_build_object('version',1,'retry',true);
    end if;
    update public.membership_outbox set receipt_id=p_receipt_id,
        acknowledged_at=clock_timestamp(),claim_id=null,claim_expires_at=null
        where event_id=p_event_id;
    perform public.membership_notify_provider(outbox.account_id,outbox.provider,true);
    return jsonb_build_object('version',1,'acknowledged',true,
        'eventId',p_event_id,'receiptId',p_receipt_id);
end;
$function$;

-- The claim-bound acknowledgement; ACK v2 is unchanged and covers v2 and v3 claims alike.
create or replace function public.membership_ack_claim(
    p_event_id uuid,p_receipt_id uuid,p_claim_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare
    outbox public.membership_outbox;
    account uuid;
begin
    perform set_config('lock_timeout',public.membership_lock_budget(),true);
    if p_event_id is null or p_receipt_id is null or p_claim_id is null then
        raise exception 'Invalid acknowledgement';
    end if;
    select account_id into account from public.membership_outbox where event_id=p_event_id;
    if not found then raise exception 'Receipt conflict'; end if;
    if not pg_try_advisory_xact_lock(hashtextextended(account::text,702)) then
        return jsonb_build_object('version',2,'retry',true);
    end if;
    select * into outbox from public.membership_outbox
        where event_id=p_event_id for update;
    if not found then raise exception 'Receipt conflict'; end if;
    if outbox.receipt_id is not null then
        if outbox.receipt_id<>p_receipt_id then raise exception 'Receipt conflict'; end if;
        return jsonb_build_object('version',2,'acknowledged',true,
            'eventId',p_event_id,'receiptId',p_receipt_id,'claimId',p_claim_id);
    end if;
    if outbox.claim_id is distinct from p_claim_id
        or outbox.claim_expires_at <= clock_timestamp() then
        return jsonb_build_object('version',2,'retry',true);
    end if;
    update public.membership_outbox set receipt_id=p_receipt_id,
        acknowledged_at=clock_timestamp(),claim_id=null,claim_expires_at=null
        where event_id=p_event_id;
    -- An old acknowledgement still repairs delivery for the newest head of its provider.
    perform public.membership_notify_provider(outbox.account_id,outbox.provider,true);
    return jsonb_build_object('version',2,'acknowledged',true,
        'eventId',p_event_id,'receiptId',p_receipt_id,'claimId',p_claim_id);
end;
$function$;

-- Internal helpers have no client or service grants; CREATE OR REPLACE keeps existing grants.
revoke all on function public.membership_provider_empty_evidence(text),
 public.membership_provider_snapshot_json(public.membership_provider_heads),
 public.membership_notify_provider(uuid,text,boolean),
 public.membership_provider_fence(uuid,text,text,boolean) from public, anon, authenticated, service_role;
revoke all on function public.membership_funding_fence(uuid,text,text,boolean),
 public.membership_funding_claim(uuid,integer) from public, anon, authenticated;
grant execute on function public.membership_funding_fence(uuid,text,text,boolean),
 public.membership_funding_claim(uuid,integer) to service_role;

commit;
