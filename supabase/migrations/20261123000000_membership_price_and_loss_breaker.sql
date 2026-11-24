BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Membership qualifies by tier price, not by an allow-list, and confirmed paid-access loss may
-- keep the member's remaining paid tiers. Each fragment below is rewritten in the validator's
-- CURRENT definition: Patreon loss may carry tiers, Patreon qualifying evidence needs any tier
-- (not a listed one), Boosty loss may carry its level, and both workers learn whether a linked
-- member's current evidence already records loss (for the mass-loss breaker). nonqualifying and
-- paidAccessEndedAt <= verifiedAt (Patreon: equal) are unchanged. A definition without exactly
-- one copy of a fragment aborts the migration.
do $migration$
declare patch record; definition text;
begin
    for patch in select * from (values
        ('public.patreon_role_sync(text,text,text,jsonb)'::regprocedure, $c$or v_evidence->'tierIds' is distinct from '[]'::jsonb$c$, ''),
        ('public.patreon_role_sync(text,text,text,jsonb)'::regprocedure, $c$ where policy->'qualifyingTierIds' @> jsonb_build_array(t)$c$, ''),
        ('public.patreon_role_sync(text,text,text,jsonb)'::regprocedure, $c$jsonb_build_object('allocationFence',fence)$c$,
            $c$jsonb_build_object('allocationFence',fence,'allocationLost',coalesce((select m.evidence ? 'paidAccessEndedAt' from public.membership_heads m where m.account_id=(fence->>'accountId')::uuid),false))$c$),
        ('boosty_membership.valid_evidence(jsonb,text)'::regprocedure, $c$ and e->'tierIds'='[]'::jsonb$c$, ''),
        ('boosty_membership.linked(jsonb)'::regprocedure, $c$'linkGeneration',h.link_generation::text,$c$,
            $c$'linkGeneration',h.link_generation::text,'lost',h.evidence ? 'paidAccessEndedAt',$c$)
    ) as p(fn, fragment, replacement) loop
        definition := pg_get_functiondef(patch.fn);
        if (length(definition) - length(replace(definition, patch.fragment, ''))) <> length(patch.fragment) then
            raise exception 'unexpected definition of %', patch.fn;
        end if;
        execute replace(definition, patch.fragment, patch.replacement);
    end loop;
end
$migration$;

-- Mass-loss breaker. A provider trips while more than 25% of its readable linked members (at least
-- 10) newly lost paid access within the last 6 hours, counted per account across runs. A trip
-- withholds the reporting run's new loss and alerts at most every 6 hours, also while an operator
-- allowance (at most 24 hours, see membership_loss_breaker_allow) lets the loss through.
create table public.membership_loss_breakers (
    provider text primary key check (provider in ('patreon','boosty')),
    tripped_at timestamptz,
    alerted_at timestamptz,
    allowed_at timestamptz,
    allowed_until timestamptz,
    allowed_by text check (length(allowed_by) between 1 and 200),
    allowed_reason text check (length(allowed_reason) between 10 and 1000),
    check ((allowed_until is null) = (allowed_at is null) and (allowed_until is null) = (allowed_by is null)
        and (allowed_until is null) = (allowed_reason is null)),
    check (allowed_until is null or (allowed_until > allowed_at and allowed_until <= allowed_at + interval '24 hours'))
);
insert into public.membership_loss_breakers(provider) values ('patreon'), ('boosty');

-- New-loss observations inside the rolling window, one per account; older rows are pruned on each check.
create table public.membership_loss_observations (
    provider text not null references public.membership_loss_breakers(provider),
    account_id uuid not null,
    observed_at timestamptz not null default clock_timestamp(),
    primary key (provider, account_id)
);
alter table public.membership_loss_breakers enable row level security;
alter table public.membership_loss_observations enable row level security;
revoke all on public.membership_loss_breakers, public.membership_loss_observations from public, anon, authenticated, service_role;

-- Records the accounts a run newly lost under the provider's current worker lease and answers
-- whether to withhold that loss, whether an operator allowance bypasses it, and whether to alert.
create function public.membership_loss_breaker(p_provider text, p_token uuid, p_accounts uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.membership_loss_breakers; linked integer; recent integer; bypass boolean; alert boolean;
begin
    perform set_config('lock_timeout','2000',true);
    if p_provider = 'boosty' then perform boosty_membership.require_lease(p_token);
    elsif p_provider is distinct from 'patreon' then raise exception 'invalid_loss_breaker_provider';
    elsif p_token is null or not exists(select 1 from patreon_roles.sync_state
        where singleton and worker_token = p_token and worker_until > clock_timestamp()) then raise exception 'stale_loss_breaker_lease';
    end if;
    if p_accounts is null or cardinality(p_accounts) > 5000 or array_position(p_accounts, null) is not null then raise exception 'invalid_loss_breaker_accounts'; end if;
    select * into strict b from public.membership_loss_breakers where provider = p_provider for update;
    delete from public.membership_loss_observations where provider = p_provider and observed_at <= clock_timestamp() - interval '6 hours';
    insert into public.membership_loss_observations(provider, account_id) select p_provider, a from unnest(p_accounts) a on conflict do nothing;
    select count(*) into recent from public.membership_loss_observations where provider = p_provider;
    -- The population the worker re-reads: linked Patreon members with a campaign membership, or linked Boosty heads.
    if p_provider = 'patreon' then
        select count(*) into linked from patreon_roles.memberships m join public.patreon_accounts a on a.patreon_user_id = m.patreon_user_id
            join public.membership_heads h on h.account_id = a.user_id and h.patreon_user_id = a.patreon_user_id and h.link_state = 'linked';
    else
        select count(*) into linked from public.membership_provider_heads where provider = 'boosty' and link_state = 'linked';
    end if;
    if linked < 10 or recent <= linked * 0.25 then return jsonb_build_object('withhold', false, 'bypass', false, 'alert', false); end if;
    bypass := coalesce(b.allowed_until > clock_timestamp() and b.allowed_until <= b.allowed_at + interval '24 hours', false);
    alert := b.alerted_at is null or b.alerted_at <= clock_timestamp() - interval '6 hours';
    update public.membership_loss_breakers set tripped_at = clock_timestamp(),
        alerted_at = case when alert then clock_timestamp() else alerted_at end where provider = p_provider;
    return jsonb_build_object('withhold', not bypass, 'bypass', bypass, 'alert', alert);
end $$;
revoke all on function public.membership_loss_breaker(text,uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.membership_loss_breaker(text,uuid,uuid[]) to service_role;

-- Audited operator allowance for a mass loss confirmed to be real: 1-24 hours, with who and why.
-- Run as an administrator (SQL editor), never from an Edge function:
--   select public.membership_loss_breaker_allow('patreon', 3, '<operator>', '<why these losses are real>');
create function public.membership_loss_breaker_allow(p_provider text, p_hours integer, p_by text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare allowed_from timestamptz := clock_timestamp();
begin
    if p_hours is null or p_hours not between 1 and 24 then raise exception 'invalid_loss_breaker_window'; end if;
    update public.membership_loss_breakers set allowed_at = allowed_from, allowed_until = allowed_from + make_interval(hours => p_hours),
        allowed_by = btrim(p_by), allowed_reason = btrim(p_reason) where provider = p_provider;
    if not found then raise exception 'invalid_loss_breaker_provider'; end if;
    return jsonb_build_object('provider', p_provider, 'allowedUntil', to_char((allowed_from + make_interval(hours => p_hours)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;
revoke all on function public.membership_loss_breaker_allow(text,integer,text,text) from public, anon, authenticated, service_role;

COMMIT;
