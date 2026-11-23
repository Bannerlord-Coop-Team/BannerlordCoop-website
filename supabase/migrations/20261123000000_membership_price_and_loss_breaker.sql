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

-- Mass-loss breaker state per provider. An operator who has confirmed a mass loss is real allows
-- it for a bounded window: update public.membership_loss_breakers set allowed_until =
-- now() + interval '2 hours' where provider = 'patreon';
create table public.membership_loss_breakers (
    provider text primary key check (provider in ('patreon','boosty')),
    tripped_at timestamptz,
    alerted_at timestamptz,
    allowed_until timestamptz
);
insert into public.membership_loss_breakers(provider) values ('patreon'), ('boosty');
alter table public.membership_loss_breakers enable row level security;
revoke all on public.membership_loss_breakers from public, anon, authenticated, service_role;

-- Records a trip under the provider's current worker lease. Answers whether an operator allows
-- loss now (bypass) and whether to alert (at most every 6 hours).
create function public.membership_loss_breaker(p_provider text, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.membership_loss_breakers; alert boolean;
begin
    perform set_config('lock_timeout','2000',true);
    if p_provider = 'boosty' then perform boosty_membership.require_lease(p_token);
    elsif p_provider is distinct from 'patreon' then raise exception 'invalid_loss_breaker_provider';
    elsif p_token is null or not exists(select 1 from patreon_roles.sync_state
        where singleton and worker_token = p_token and worker_until > clock_timestamp()) then raise exception 'stale_loss_breaker_lease';
    end if;
    select * into strict b from public.membership_loss_breakers where provider = p_provider for update;
    if b.allowed_until > clock_timestamp() then return jsonb_build_object('bypass', true, 'alert', false); end if;
    alert := b.alerted_at is null or b.alerted_at < clock_timestamp() - interval '6 hours';
    update public.membership_loss_breakers set tripped_at = clock_timestamp(),
        alerted_at = case when alert then clock_timestamp() else alerted_at end where provider = p_provider;
    return jsonb_build_object('bypass', false, 'alert', alert);
end $$;
revoke all on function public.membership_loss_breaker(text,uuid) from public, anon, authenticated;
grant execute on function public.membership_loss_breaker(text,uuid) to service_role;

COMMIT;
