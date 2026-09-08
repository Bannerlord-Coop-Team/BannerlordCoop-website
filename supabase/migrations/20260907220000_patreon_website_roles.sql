begin;

-- Website membership authority only. This schema has no control-plane privileges.
create schema patreon_roles;
revoke all on schema patreon_roles from public, anon, authenticated;

create table patreon_roles.sync_state (
    singleton boolean primary key default true check (singleton),
    campaign_id text not null check (campaign_id ~ '^[1-9][0-9]{0,19}$'),
    tier_id text not null check (tier_id ~ '^[1-9][0-9]{0,19}$'),
    worker_token uuid,
    worker_until timestamptz,
    cursor text not null default '' check (length(cursor) <= 1024),
    scan_due timestamptz not null default now(),
    scan_generation bigint not null default 1 check (scan_generation > 0),
    scan_pages integer not null default 0 check (scan_pages between 0 and 1000)
);

create table patreon_roles.memberships (
    member_id uuid primary key,
    generation bigint not null default 1 check (generation > 0),
    due_at timestamptz not null default now(),
    patreon_user_id text check (patreon_user_id ~ '^[1-9][0-9]{0,19}$'),
    eligible boolean not null default false,
    website_user_id uuid references auth.users(id) on delete set null,
    observed_at timestamptz,
    last_error text check (last_error in ('upstream_unavailable', 'account_unmatched'))
);
create index patreon_roles_due on patreon_roles.memberships(due_at, member_id);
create index patreon_roles_website_users on patreon_roles.memberships(website_user_id);
create index patreon_roles_patreon_users on patreon_roles.memberships(patreon_user_id);

create table patreon_roles.grants (
    user_id uuid primary key references auth.users(id) on delete cascade,
    marker uuid not null unique default gen_random_uuid(),
    previous_role text check (previous_role = 'User'),
    created_at timestamptz not null default now()
);

create table patreon_roles.audit (
    id bigint generated always as identity primary key,
    user_id uuid not null,
    action text not null check (action in ('granted', 'revoked', 'manual_override')),
    created_at timestamptz not null default now()
);

alter table patreon_roles.sync_state enable row level security;
alter table patreon_roles.memberships enable row level security;
alter table patreon_roles.grants enable row level security;
alter table patreon_roles.audit enable row level security;
revoke all on all tables in schema patreon_roles from public, anon, authenticated;
revoke all on all sequences in schema patreon_roles from public, anon, authenticated;

create function patreon_roles.project_role(p_user uuid)
returns void language plpgsql
set search_path = ''
as $function$
declare
    v_user auth.users%rowtype;
    v_grant patreon_roles.grants%rowtype;
    v_eligible boolean;
    v_metadata jsonb;
begin
    if p_user is null then return; end if;
    -- Keep the foreign-key KEY SHARE lock used by concurrent OAuth linking
    -- compatible while serializing non-key Auth metadata writes.
    select * into v_user from auth.users where id = p_user for no key update;
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
revoke all on function patreon_roles.project_role(uuid) from public, anon, authenticated;

-- The sole Data API entrypoint is service-role-only and accepts a closed set of
-- operations. All state transitions and role projection share one transaction.
create function public.patreon_role_sync(p_campaign text, p_tier text, p_operation text, p_input jsonb)
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
    if p_campaign is null or p_campaign !~ '^[1-9][0-9]{0,19}$'
        or p_tier is null or p_tier !~ '^[1-9][0-9]{0,19}$'
        or p_input is null or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 131072
        or p_operation is null or p_operation not in ('queue', 'acquire', 'release', 'complete', 'failed', 'discovered') then
        raise exception 'invalid_patreon_request';
    end if;
    insert into patreon_roles.sync_state(singleton, campaign_id, tier_id)
        values (true, p_campaign, p_tier) on conflict do nothing;
    select * into v_state from patreon_roles.sync_state where singleton for update;
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

revoke all on function public.patreon_role_sync(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.patreon_role_sync(text, text, text, jsonb) to service_role;

comment on function public.patreon_role_sync(text, text, text, jsonb) is
    'Private Patreon membership queue, worker lease and atomic website role projection. Never allocates or deletes servers.';

-- Replacing/deleting a link invalidates its previous grants in the same
-- transaction. New links queue a fresh observation; cached membership data must
-- never migrate a role to a newly linked account. Use the same state-lock order
-- as the worker, including when OAuth completion runs concurrently with refresh.
create function patreon_roles.account_link_changed()
returns trigger language plpgsql security definer
set search_path = ''
as $function$
declare
    v_user uuid;
    v_old_id text;
    v_new_id text;
begin
    if TG_OP <> 'INSERT' then v_user := OLD.user_id; v_old_id := OLD.patreon_user_id; end if;
    if TG_OP <> 'DELETE' then v_user := NEW.user_id; v_new_id := NEW.patreon_user_id; end if;
    if TG_OP = 'UPDATE' and OLD.user_id <> NEW.user_id then
        raise exception 'patreon_link_owner_immutable';
    end if;
    perform 1 from patreon_roles.sync_state where singleton for update;
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
revoke all on function patreon_roles.account_link_changed() from public, anon, authenticated;
create trigger patreon_role_link_changed after insert or update or delete on public.patreon_accounts
    for each row execute function patreon_roles.account_link_changed();

commit;
