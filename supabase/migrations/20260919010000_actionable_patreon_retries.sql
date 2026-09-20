begin;

-- Keep the reviewed role-sync implementation intact behind a small lock-aware
-- public seam. Expected singleton contention is protocol backpressure, not a
-- PostgreSQL error.
alter function public.patreon_role_sync(text, text, text, jsonb)
    set schema patreon_roles;
alter function patreon_roles.patreon_role_sync(text, text, text, jsonb)
    rename to patreon_role_sync_serialized_v1;
revoke all on function patreon_roles.patreon_role_sync_serialized_v1(text, text, text, jsonb)
    from public, anon, authenticated, service_role;

create function public.patreon_role_sync(
    p_campaign text,
    p_tier text,
    p_operation text,
    p_input jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_result jsonb;
    v_member_id uuid;
    v_deferred boolean := false;
begin
    if p_campaign is null or p_campaign !~ '^[1-9][0-9]{0,19}$'
        or p_tier is null or p_tier !~ '^[1-9][0-9]{0,19}$'
        or p_input is null or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 131072
        or p_operation is null or p_operation not in ('queue', 'acquire', 'release', 'complete', 'failed', 'discovered') then
        raise exception 'invalid_patreon_request';
    end if;

    insert into patreon_roles.sync_state(singleton, campaign_id, tier_id)
        values (true, p_campaign, p_tier) on conflict do nothing;
    perform 1 from patreon_roles.sync_state where singleton for update skip locked;
    if not found then
        return jsonb_build_object('retry', true);
    end if;

    v_result := patreon_roles.patreon_role_sync_serialized_v1(
        p_campaign, p_tier, p_operation, p_input
    );

    -- A member that is not linked to a website account has no current role to
    -- protect. Park persistent upstream failures until a new signed event,
    -- discovery result or account link makes the row due again.
    if p_operation = 'failed' and v_result = jsonb_build_object('retry', true) then
        v_member_id := (p_input ->> 'memberId')::uuid;
        update patreon_roles.memberships membership
            set due_at = 'infinity'::timestamptz
            where membership.member_id = v_member_id
                and membership.website_user_id is null
                and not exists (
                    select 1 from public.patreon_accounts account
                    where account.patreon_user_id = membership.patreon_user_id
                )
            returning true into v_deferred;
        if coalesce(v_deferred, false) then
            return jsonb_build_object('deferred', true);
        end if;
    end if;

    return v_result;
end;
$function$;

revoke all on function public.patreon_role_sync(text, text, text, jsonb)
    from public, anon, authenticated;
grant execute on function public.patreon_role_sync(text, text, text, jsonb)
    to service_role;
comment on function public.patreon_role_sync(text, text, text, jsonb) is
    'Service-role Patreon reconciliation seam. Lock contention returns {"retry":true}; unlinked upstream failures return {"deferred":true}.';

-- This job predates the updated_at statistics schema and now fails every day by
-- querying the removed last_seen_at column. No current retention contract uses
-- that predicate, so remove the stale job instead of guessing a replacement.
do $block$
declare
    v_job_id bigint;
begin
    if to_regclass('cron.job') is null then
        return;
    end if;
    execute 'select jobid from cron.job where jobname = $1'
        into v_job_id using 'platform_statistics_cleanup_daily';
    if v_job_id is not null then
        execute 'select cron.unschedule($1)' using v_job_id;
    end if;
end;
$block$;

commit;
