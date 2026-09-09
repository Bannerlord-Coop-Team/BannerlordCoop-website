begin;

-- Explicit activation follows worker deployment and Vault configuration. The
-- existing minute scheduler can continue safely during the rolling upgrade.
alter table patreon_roles.sync_state
    add column dispatch_enabled boolean not null default false,
    add column dispatch_until timestamptz,
    add column dispatch_request_id bigint,
    add column dispatch_error text check (dispatch_error in ('dispatch_unavailable')),
    add column recent_runs timestamptz[] not null default '{}' check (
        cardinality(recent_runs) <= 3 and array_position(recent_runs, null) is null
    );
alter table patreon_roles.memberships add column priority smallint not null default 0 check (priority between 0 and 2);
create index patreon_roles_priority_due on patreon_roles.memberships(priority desc, due_at, member_id);

-- Preserve every legacy deadline. Queue events, account links and worker claims
-- retain observed_at, so timestamps cannot identify ordinary periodic refreshes.
-- The next successful completion adopts the new linked/unlinked schedule.

create or replace function public.patreon_role_sync(p_campaign text, p_tier text, p_operation text, p_input jsonb)
returns jsonb language plpgsql security definer
set search_path = ''
as $function$
declare
    v_state patreon_roles.sync_state%rowtype;
    v_member patreon_roles.memberships%rowtype;
    v_token uuid;
    v_id uuid;
    v_old_user uuid;
    v_new_user uuid;
    v_jobs jsonb;
    v_eligible boolean;
    v_member_id jsonb;
    v_identity jsonb;
    v_user_id text;
    v_linked boolean;
begin
    perform set_config('lock_timeout',public.membership_lock_budget(),true);
    perform public.membership_lock();
    if p_campaign is null or p_campaign !~ '^[1-9][0-9]{0,19}$'
        or p_tier is null or p_tier !~ '^[1-9][0-9]{0,19}$'
        or p_input is null or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 131072
        or p_operation is null or p_operation not in ('queue', 'acquire', 'release', 'complete', 'failed', 'discovered') then
        raise exception 'invalid_patreon_request';
    end if;
    insert into patreon_roles.sync_state(singleton, campaign_id, tier_id)
        values (true, p_campaign, p_tier) on conflict do nothing;
    select * into v_state from patreon_roles.sync_state where singleton for update nowait;
    if v_state.campaign_id <> p_campaign or v_state.tier_id <> p_tier then
        raise exception 'patreon_configuration_mismatch';
    end if;

    if p_operation = 'queue' then
        v_id := (p_input ->> 'memberId')::uuid;
        if v_id is null then raise exception 'invalid_member'; end if;
        if not exists (select 1 from patreon_roles.memberships where member_id = v_id)
            and (select count(*) from patreon_roles.memberships) >= 100000 then
            raise exception 'patreon_membership_limit';
        end if;
        insert into patreon_roles.memberships(member_id, priority) values (v_id, 1)
            on conflict (member_id) do update
            set generation = patreon_roles.memberships.generation + 1, due_at = now(),
                priority = greatest(patreon_roles.memberships.priority, 1);
        return jsonb_build_object('queued', true);
    end if;

    if p_operation = 'acquire' then
        if v_state.worker_until > now() then return null; end if;
        if v_state.dispatch_enabled and (select count(*) from unnest(v_state.recent_runs) started
            where started > now() - interval '1 minute') >= 3 then return null; end if;
        v_token := gen_random_uuid();
        update patreon_roles.sync_state set worker_token = v_token, worker_until = now() + interval '2 minutes',
            dispatch_until = null,
            recent_runs = array_append(array(select started from unnest(v_state.recent_runs) started
                where started > now() - interval '1 minute' order by started desc limit 2), now())
            where singleton;
        with selected as materialized (
            select member_id, priority, due_at from patreon_roles.memberships
                where due_at <= now() order by priority desc, due_at, member_id limit 20
        ), claimed as (
            update patreon_roles.memberships set due_at = now() + interval '5 minutes', priority = 0
                where member_id in (select member_id from selected) returning member_id, generation
        ) select coalesce(jsonb_agg(jsonb_build_object('memberId', claimed.member_id, 'generation', generation)
            order by selected.priority desc, selected.due_at, claimed.member_id), '[]'::jsonb)
            into v_jobs from claimed join selected using (member_id);
        return jsonb_build_object('token', v_token, 'jobs', v_jobs, 'scanDue', v_state.scan_due <= now(),
            'scanGeneration', v_state.scan_generation, 'cursor', v_state.cursor);
    end if;

    v_token := (p_input ->> 'token')::uuid;
    if v_token is null or v_state.worker_token is distinct from v_token or v_state.worker_until <= now() then
        return jsonb_build_object('stale', true);
    end if;
    if p_operation = 'release' then
        update patreon_roles.sync_state set worker_token = null, worker_until = null where singleton;
        return jsonb_build_object('released', true);
    end if;

    if p_operation = 'discovered' then
        if v_state.scan_generation is distinct from (p_input ->> 'scanGeneration')::bigint then
            return jsonb_build_object('stale', true);
        end if;
        if jsonb_typeof(p_input -> 'memberIds') is distinct from 'array'
            or jsonb_array_length(p_input -> 'memberIds') > 1000
            or jsonb_typeof(p_input -> 'cursor') is distinct from 'string'
            or length(p_input ->> 'cursor') > 1024 then raise exception 'invalid_discovery'; end if;
        if (p_input ->> 'cursor' <> '' and p_input ->> 'cursor' = v_state.cursor)
            or v_state.scan_pages >= 1000 then raise exception 'patreon_pagination_limit'; end if;
        -- New workers include identity mappings so discovery need not fetch every
        -- unlinked member. Accept the previous memberIds-only format during rollout.
        if p_input ? 'members' and (
            jsonb_typeof(p_input -> 'members') is distinct from 'array'
            or jsonb_array_length(p_input -> 'members') <> jsonb_array_length(p_input -> 'memberIds')
        ) then raise exception 'invalid_discovery'; end if;
        if p_input ? 'members' and (
            (select count(distinct value ->> 'memberId') from jsonb_array_elements(p_input -> 'members'))
                <> jsonb_array_length(p_input -> 'members')
            or (select count(distinct value) from jsonb_array_elements(p_input -> 'memberIds'))
                <> jsonb_array_length(p_input -> 'memberIds')
        ) then raise exception 'invalid_discovery'; end if;
        for v_member_id in select value from jsonb_array_elements(p_input -> 'memberIds') loop
            v_id := (v_member_id #>> '{}')::uuid;
            if v_id is null then raise exception 'invalid_member'; end if;
            if p_input ? 'members' then
                select value into v_identity from jsonb_array_elements(p_input -> 'members')
                    where value ->> 'memberId' = v_id::text;
                v_user_id := v_identity ->> 'userId';
                if v_user_id is null or v_user_id !~ '^[1-9][0-9]{0,19}$' then
                    raise exception 'invalid_discovery_identity';
                end if;
                if exists(select 1 from patreon_roles.memberships where member_id = v_id
                    and patreon_user_id is not null and patreon_user_id <> v_user_id) then
                    raise exception 'patreon_identity_changed';
                end if;
                v_linked := exists(select 1 from public.patreon_accounts where patreon_user_id = v_user_id);
                insert into patreon_roles.memberships(member_id, patreon_user_id, due_at, priority)
                    values (v_id, v_user_id, case when v_linked then now() else 'infinity'::timestamptz end,
                        case when v_linked then 2 else 0 end)
                    on conflict (member_id) do update set
                        patreon_user_id = excluded.patreon_user_id,
                        due_at = case when patreon_roles.memberships.patreon_user_id is null and v_linked
                            then now() else patreon_roles.memberships.due_at end,
                        priority = case when patreon_roles.memberships.patreon_user_id is null and v_linked
                            then 2 else patreon_roles.memberships.priority end;
            else
                insert into patreon_roles.memberships(member_id) values (v_id) on conflict do nothing;
            end if;
        end loop;
        if (select count(*) from patreon_roles.memberships) > 100000 then raise exception 'patreon_membership_limit'; end if;
        update patreon_roles.sync_state set cursor = p_input ->> 'cursor',
            scan_due = case when p_input ->> 'cursor' = '' then now() + interval '6 hours' else now() end,
            scan_pages = case when p_input ->> 'cursor' = '' then 0 else scan_pages + 1 end
            where singleton;
        return jsonb_build_object('discovered', true);
    end if;

    v_id := (p_input ->> 'memberId')::uuid;
    select * into v_member from patreon_roles.memberships where member_id = v_id for update;
    if not found or v_member.generation is distinct from (p_input ->> 'generation')::bigint then
        return jsonb_build_object('stale', true);
    end if;
    if p_operation = 'failed' then
        update patreon_roles.memberships set last_error = 'upstream_unavailable',
            due_at = least(due_at, now() + interval '5 minutes') where member_id = v_id;
        return jsonb_build_object('retry', true);
    end if;
    if jsonb_typeof(p_input -> 'eligible') is distinct from 'boolean'
        or coalesce(p_input ->> 'userId', '') !~ '^[1-9][0-9]{0,19}$' then raise exception 'invalid_membership'; end if;
    if v_member.patreon_user_id is not null and v_member.patreon_user_id <> p_input ->> 'userId' then
        raise exception 'patreon_identity_changed';
    end if;
    v_eligible := (p_input ->> 'eligible')::boolean;
    v_old_user := v_member.website_user_id;
    if v_eligible then
        select u.id into v_new_user from public.patreon_accounts a
            join auth.users u on u.id = a.user_id
            where a.patreon_user_id = p_input ->> 'userId'
                and u.email_confirmed_at is not null and u.deleted_at is null
                and (u.banned_until is null or u.banned_until <= now());
    end if;
    -- Preserve the shared membership lock order before assigning the Auth FK.
    perform 1 from auth.users where id in (v_old_user, v_new_user) order by id for no key update nowait;
    update patreon_roles.memberships set patreon_user_id = p_input ->> 'userId',
        eligible = v_eligible, website_user_id = v_new_user, observed_at = now(),
        due_at = case when exists(select 1 from public.patreon_accounts
            where patreon_user_id = p_input ->> 'userId') then now() + interval '6 hours' else 'infinity'::timestamptz end,
        last_error = case when v_eligible and v_new_user is null then 'account_unmatched' else null end
        where member_id = v_id;
    -- All sync operations hold the state lock; account rows additionally
    -- serialize role projection with the Auth API's administrator updates.
    perform patreon_roles.project_role(v_old_user);
    if v_new_user is distinct from v_old_user then perform patreon_roles.project_role(v_new_user); end if;
    return jsonb_build_object('applied', true);
end;
$function$;

create or replace function patreon_roles.account_link_changed()
returns trigger language plpgsql security definer
set search_path = ''
as $function$
declare
    v_user uuid;
    v_old_id text;
    v_new_id text;
begin
    perform set_config('lock_timeout',public.membership_lock_budget(),true);
    perform public.membership_lock();
    if TG_OP <> 'INSERT' then v_user := OLD.user_id; v_old_id := OLD.patreon_user_id; end if;
    if TG_OP <> 'DELETE' then v_user := NEW.user_id; v_new_id := NEW.patreon_user_id; end if;
    if TG_OP = 'UPDATE' and OLD.user_id <> NEW.user_id then
        raise exception 'patreon_link_owner_immutable';
    end if;
    perform 1 from patreon_roles.sync_state where singleton for update nowait;
    if v_old_id is distinct from v_new_id then
        update patreon_roles.memberships set website_user_id = null where website_user_id = v_user;
        perform patreon_roles.project_role(v_user);
    end if;
    update patreon_roles.memberships set generation = generation + 1,
        due_at = case when patreon_user_id = v_new_id then now() else 'infinity'::timestamptz end,
        priority = case when patreon_user_id = v_new_id then 2 else 0 end
        where patreon_user_id = v_old_id or patreon_user_id = v_new_id;
    -- Existing mappings need only a targeted refresh. An unknown identity starts
    -- a fresh discovery generation, fencing any page already in flight.
    if v_new_id is not null and not exists(
        select 1 from patreon_roles.memberships where patreon_user_id = v_new_id
    ) then
        update patreon_roles.sync_state set scan_due = now(), cursor = '', scan_pages = 0,
            scan_generation = scan_generation + 1 where singleton;
    end if;
    return null;
end;
$function$;

-- The outbox lives in pg_net, which sends only after transaction commit. A
-- short dispatch lease coalesces concurrent events; the existing worker lease
-- fences execution. Recovery retries lost HTTP requests after that lease expires.
create function patreon_roles.dispatch()
returns bigint language plpgsql security definer
set search_path = ''
as $function$
declare
    v_state patreon_roles.sync_state%rowtype;
    v_url text;
    v_key text;
    v_request bigint;
begin
    perform set_config('lock_timeout',public.membership_lock_budget(),true);
    perform public.membership_lock();
    select * into v_state from patreon_roles.sync_state where singleton for update nowait;
    if not found or not v_state.dispatch_enabled
        or v_state.worker_until > now() or v_state.dispatch_until > now()
        or (select count(*) from unnest(v_state.recent_runs) started
            where started > now() - interval '1 minute') >= 3
        or (v_state.scan_due > now() and not exists(
            select 1 from patreon_roles.memberships where due_at <= now()
        )) then return null; end if;
    begin
        select decrypted_secret into strict v_url from vault.decrypted_secrets
            where name = 'patreon_roles_function_url';
        select decrypted_secret into strict v_key from vault.decrypted_secrets
            where name = 'patreon_roles_sync_secret';
        if v_url is null or v_key is null
            or v_url !~ '^https://[a-z]{20}\.supabase\.co/functions/v1/patreon-roles$'
            or length(v_key) not between 16 and 4096 or v_key ~ E'[\r\n]' then
            raise exception 'invalid_dispatch_configuration';
        end if;
        select net.http_post(url := v_url,
            headers := jsonb_build_object('Content-Type', 'application/json', 'X-Patreon-Sync-Key', v_key),
            body := '{}'::jsonb, timeout_milliseconds := 60000) into v_request;
        if v_request is null then raise exception 'missing_dispatch_receipt'; end if;
        update patreon_roles.sync_state set dispatch_until = now() + interval '2 minutes',
            dispatch_request_id = v_request, dispatch_error = null where singleton;
        return v_request;
    exception when others then
        -- Linking and signed event ingestion remain durable even if pg_net or
        -- Vault is unavailable. Do not log or return the exception's secret data.
        update patreon_roles.sync_state set dispatch_error = 'dispatch_unavailable' where singleton;
        return null;
    end;
end;
$function$;
revoke all on function patreon_roles.dispatch() from public, anon, authenticated, service_role;

create function patreon_roles.dispatch_changed_work()
returns trigger language plpgsql security definer
set search_path = ''
as $function$
begin
    perform patreon_roles.dispatch();
    return null;
end;
$function$;
revoke all on function patreon_roles.dispatch_changed_work() from public, anon, authenticated, service_role;

create trigger patreon_dispatch_memberships after insert or update of due_at on patreon_roles.memberships
    for each statement execute function patreon_roles.dispatch_changed_work();
-- A link requesting discovery, a newly discovered page, or worker release can
-- all uncover more due work. Dispatcher-only updates do not recurse here.
create trigger patreon_dispatch_state after update of worker_token, scan_due on patreon_roles.sync_state
    for each statement execute function patreon_roles.dispatch_changed_work();

comment on function patreon_roles.dispatch() is
    'Operator-only conditional pg_net wakeup. Call from the five-minute recovery cron; no due work means no HTTP request.';

commit;
