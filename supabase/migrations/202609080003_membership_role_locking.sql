begin;
-- Applied PR104 SQL is immutable. Only lock acquisition changes below; website
-- role policy remains independent of CP authority. Legacy link writes enter
-- after their tuple lock, so waiting for the global fence would invert RPC order.
-- NOWAIT/try-lock refusal raises 55P03 and rolls back the entire statement.
-- 100ms is a per-lock contention budget for invisible unique/FK waits, NOT a
-- whole-request deadline. Local assignment in each function SET search_path
-- scope restores the caller setting on exit and preserves any tighter budget.

create or replace function patreon_roles.project_role(p_user uuid)
returns void language plpgsql
set search_path = ''
as $function$
declare
    v_user auth.users%rowtype;
    v_grant patreon_roles.grants%rowtype;
    v_eligible boolean;
    v_metadata jsonb;
begin
    perform set_config('lock_timeout',public.membership_lock_budget(),true);
    perform public.membership_lock();
    if p_user is null then return; end if;
    -- Refuse conflicting Auth deletion/metadata writes; never skip projection.
    select * into v_user from auth.users where id = p_user for no key update nowait;
    if not found then return; end if;
    v_metadata := coalesce(v_user.raw_app_meta_data, '{}'::jsonb);
    select * into v_grant from patreon_roles.grants where user_id = p_user;
    -- Serialize with Auth writes and merge only our keys. Never replace metadata
    -- from an earlier HTTP read, which could undo a concurrent administrator edit.
    if v_grant.user_id is not null and (
        v_metadata ->> 'role' is distinct from 'Standard Server'
        or v_metadata ->> 'patreon_standard_server_grant' is distinct from v_grant.marker::text
    ) then
        delete from patreon_roles.grants where user_id = p_user;
        insert into patreon_roles.audit(user_id, action) values (p_user, 'manual_override');
        return;
    end if;
    v_eligible := v_user.email_confirmed_at is not null and v_user.deleted_at is null
        and (v_user.banned_until is null or v_user.banned_until <= now())
        and exists (
            select 1 from patreon_roles.memberships m
            join public.patreon_accounts a on a.user_id = p_user and a.patreon_user_id = m.patreon_user_id
            where m.website_user_id = p_user and m.eligible
        );
    if v_eligible and v_grant.user_id is null
        and (v_metadata ->> 'role' is null or v_metadata ->> 'role' = 'User') then
        insert into patreon_roles.grants(user_id, previous_role)
            values (p_user, v_metadata ->> 'role') returning * into v_grant;
        update auth.users set raw_app_meta_data = v_metadata || jsonb_build_object(
            'role', 'Standard Server', 'patreon_standard_server_grant', v_grant.marker::text
        ), updated_at = now() where id = p_user;
        insert into patreon_roles.audit(user_id, action) values (p_user, 'granted');
    elsif not v_eligible and v_grant.user_id is not null then
        v_metadata := v_metadata - 'patreon_standard_server_grant' - 'role';
        if v_grant.previous_role is not null then
            v_metadata := v_metadata || jsonb_build_object('role', v_grant.previous_role);
        end if;
        update auth.users set raw_app_meta_data = v_metadata, updated_at = now() where id = p_user;
        delete from patreon_roles.grants where user_id = p_user;
        insert into patreon_roles.audit(user_id, action) values (p_user, 'revoked');
    end if;
end;
$function$;

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
        insert into patreon_roles.memberships(member_id) values (v_id)
            on conflict (member_id) do update
            set generation = patreon_roles.memberships.generation + 1, due_at = now();
        return jsonb_build_object('queued', true);
    end if;

    if p_operation = 'acquire' then
        if v_state.worker_until > now() then return null; end if;
        v_token := gen_random_uuid();
        update patreon_roles.sync_state set worker_token = v_token, worker_until = now() + interval '2 minutes'
            where singleton;
        with selected as (
            select member_id from patreon_roles.memberships
                where due_at <= now() order by due_at, member_id limit 20
        ), claimed as (
            update patreon_roles.memberships set due_at = now() + interval '5 minutes'
                where member_id in (select member_id from selected) returning member_id, generation
        ) select coalesce(jsonb_agg(jsonb_build_object('memberId', member_id, 'generation', generation)), '[]'::jsonb)
            into v_jobs from claimed;
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
        for v_member_id in select value from jsonb_array_elements(p_input -> 'memberIds') loop
            v_id := (v_member_id #>> '{}')::uuid;
            if v_id is null then raise exception 'invalid_member'; end if;
            insert into patreon_roles.memberships(member_id) values (v_id) on conflict do nothing;
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
        update patreon_roles.memberships set last_error = 'upstream_unavailable' where member_id = v_id;
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
    -- Acquire Auth before the FK assignment, not only inside projection.
    perform 1 from auth.users where id in (v_old_user, v_new_user) order by id for no key update nowait;
    update patreon_roles.memberships set patreon_user_id = p_input ->> 'userId',
        eligible = v_eligible, website_user_id = v_new_user, observed_at = now(), due_at = now() + interval '15 minutes',
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
    update patreon_roles.memberships set generation = generation + 1, due_at = now()
        where patreon_user_id = v_old_id or patreon_user_id = v_new_id;
    -- A patron who joined since the last scan may not yet have a member ID.
    -- Request a scan without resetting an in-progress cursor.
    update patreon_roles.sync_state set scan_due = least(scan_due, now()), scan_generation = scan_generation + 1 where singleton;
    return null;
end;
$function$;

create or replace function public.set_live_console_assignment(
    p_user_id uuid,
    p_server_id text,
    p_owner_assigned boolean,
    p_operator_assigned boolean
)
returns void language plpgsql security definer
set search_path = ''
as $function$
declare
    v_original jsonb;
    v_metadata jsonb;
    v_key text;
    v_assigned boolean;
    v_ids jsonb;
begin
    perform set_config('lock_timeout',public.membership_lock_budget(),true);
    if p_user_id is null or p_server_id is null
        or p_server_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
        or (p_owner_assigned is null and p_operator_assigned is null) then
        raise exception 'invalid_console_assignment';
    end if;
    select coalesce(raw_app_meta_data, '{}'::jsonb) into v_original
        from auth.users where id = p_user_id for no key update nowait;
    if not found then raise exception 'console_account_not_found'; end if;
    if jsonb_typeof(v_original) <> 'object' then raise exception 'invalid_account_metadata'; end if;
    v_metadata := v_original;

    for v_key, v_assigned in select * from (values
        ('live_console_owner_server_ids', p_owner_assigned),
        ('live_console_operator_server_ids', p_operator_assigned)
    ) as assignments(key, assigned) where assigned is not null loop
        v_ids := v_metadata -> v_key;
        if jsonb_typeof(v_ids) is distinct from 'array' then v_ids := '[]'::jsonb; end if;
        if jsonb_array_length(v_ids) > 1024 then raise exception 'console_assignment_limit'; end if;
        -- Preserve other servers and the reader's valid, unique ID semantics.
        select coalesce(jsonb_agg(value order by first_position), '[]'::jsonb) into v_ids
            from (
                select value, min(position) as first_position
                from jsonb_array_elements(v_ids) with ordinality as ids(value, position)
                where jsonb_typeof(value) = 'string'
                    and length(value #>> '{}') between 1 and 128
                    and value #>> '{}' <> p_server_id
                group by value
            ) as retained;
        if v_assigned then v_ids := v_ids || jsonb_build_array(p_server_id); end if;
        if jsonb_array_length(v_ids) > 1024 then raise exception 'console_assignment_limit'; end if;
        v_metadata := jsonb_set(v_metadata, array[v_key], v_ids);
    end loop;

    if v_metadata is distinct from v_original then
        update auth.users set raw_app_meta_data = v_metadata, updated_at = now() where id = p_user_id;
    end if;
end;
$function$;

-- Narrow service-only role intent. The action authorizes actor, target and finite
-- enum; this writer cannot replay stale console assignments or arbitrary keys.
create function public.set_member_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer
set search_path = ''
as $function$
declare
    v_metadata jsonb;
begin
    perform set_config('lock_timeout',public.membership_lock_budget(),true);
    if p_user_id is null or p_role is null or p_role not in
        ('Admin', 'Server Manager', 'Standard Server', 'Premium Server', 'Developer', 'Helper', 'User') then
        raise exception 'invalid_member_role';
    end if;
    select coalesce(raw_app_meta_data, '{}'::jsonb) into v_metadata
        from auth.users where id = p_user_id for no key update nowait;
    if not found then raise exception 'member_account_not_found'; end if;
    if jsonb_typeof(v_metadata) <> 'object' then raise exception 'invalid_account_metadata'; end if;
    update auth.users set raw_app_meta_data = v_metadata || jsonb_build_object(
        'role', p_role, 'patreon_standard_server_grant', null
    ), updated_at = now() where id = p_user_id;
end;
$function$;
revoke all on function public.set_member_role(uuid,text) from public,anon,authenticated;
grant execute on function public.set_member_role(uuid,text) to service_role;
comment on function public.set_member_role(uuid,text) is
    'Service-only finite manual role intent; preserves current unrelated metadata under the Auth row lock. No CP authority.';

commit;
