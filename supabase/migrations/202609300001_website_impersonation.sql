begin;

-- Dedicated Auth sessions for administrator impersonation. Tokens never enter
-- application tables; retained session IDs identify the real actor in audits.
create table public.website_impersonations (
    id uuid primary key,
    actor_id uuid not null,
    actor_session_id uuid not null,
    target_id uuid not null,
    target_session_id uuid unique,
    created_at timestamptz not null default clock_timestamp(),
    expires_at timestamptz not null default clock_timestamp() + interval '30 minutes',
    ended_at timestamptz,
    check (actor_id <> target_id),
    check (expires_at > created_at and expires_at <= created_at + interval '31 minutes')
);
create table public.website_impersonation_sessions (
    session_id uuid primary key,
    impersonation_id uuid not null references public.website_impersonations(id)
);
create table public.website_impersonation_events (
    request_id uuid primary key,
    impersonation_id uuid not null references public.website_impersonations(id),
    action text not null check (action ~ '^[a-z][a-z0-9_.:-]{0,79}$'),
    occurred_at timestamptz not null default clock_timestamp()
);
alter table public.website_impersonation_sessions enable row level security;
alter table public.website_impersonations enable row level security;
alter table public.website_impersonation_events enable row level security;
revoke all on public.website_impersonations, public.website_impersonation_sessions, public.website_impersonation_events from public, anon, authenticated;

create function public.website_impersonation_begin(p_id uuid, p_actor_id uuid, p_actor_session_id uuid, p_target_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
    if not exists(select 1 from auth.users u join auth.sessions s on s.user_id = u.id
        where u.id = p_actor_id and s.id = p_actor_session_id and u.raw_app_meta_data->>'role' = 'Admin'
        and u.deleted_at is null and (u.banned_until is null or u.banned_until <= clock_timestamp()))
        or exists(select 1 from public.website_impersonation_sessions where session_id = p_actor_session_id)
        or not exists(select 1 from auth.users where id = p_target_id and deleted_at is null)
        or p_actor_id = p_target_id then raise insufficient_privilege; end if;
    insert into public.website_impersonations(id, actor_id, actor_session_id, target_id)
        values(p_id, p_actor_id, p_actor_session_id, p_target_id);
    insert into public.website_impersonation_events(request_id, impersonation_id, action) values(p_id, p_id, 'started');
end;
$$;

create function public.website_impersonation_bind(p_id uuid, p_actor_id uuid, p_actor_session_id uuid, p_target_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.website_impersonations;
begin
    select * into i from public.website_impersonations where id = p_id for update;
    if i.id is null or i.actor_id <> p_actor_id or i.actor_session_id <> p_actor_session_id
        or i.ended_at is not null or i.expires_at <= clock_timestamp()
        or not exists(select 1 from auth.users u join auth.sessions s on s.user_id = u.id
            where u.id = i.actor_id and s.id = i.actor_session_id and u.raw_app_meta_data->>'role' = 'Admin'
            and u.deleted_at is null and (u.banned_until is null or u.banned_until <= clock_timestamp()))
        or not exists(select 1 from auth.sessions where id = p_target_session_id and user_id = i.target_id)
        then raise insufficient_privilege; end if;
    insert into public.website_impersonation_sessions(session_id, impersonation_id)
        values(p_target_session_id, p_id) on conflict do nothing;
    if not exists(select 1 from public.website_impersonation_sessions where session_id = p_target_session_id and impersonation_id = p_id)
        then raise insufficient_privilege; end if;
    update public.website_impersonations set target_session_id = p_target_session_id where id = p_id;
end;
$$;

create function public.website_impersonation_end(p_id uuid, p_actor_id uuid, p_actor_session_id uuid, p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare ended_id uuid;
begin
    -- A null selection recovers a damaged marker using the separately verified
    -- administrator session. End only grants issued by that exact session.
    for ended_id in update public.website_impersonations set ended_at = coalesce(ended_at, clock_timestamp())
        where (p_id is null or id = p_id) and actor_id = p_actor_id and actor_session_id = p_actor_session_id returning id
    loop
        insert into public.website_impersonation_events(request_id, impersonation_id, action)
            values(md5(p_request_id::text || ended_id::text)::uuid, ended_id, 'ended') on conflict do nothing;
    end loop;
    if p_id is not null and ended_id is null then raise insufficient_privilege; end if;
end;
$$;

create function public.website_session_context(p_action text, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i public.website_impersonations; native_session_id uuid;
begin
    if auth.uid() is null or p_action is null or p_action !~ '^[a-z][a-z0-9_.:-]{0,79}$' or p_request_id is null then
        raise insufficient_privilege;
    end if;
    native_session_id := (auth.jwt()->>'session_id')::uuid;
    if native_session_id is null then raise insufficient_privilege; end if;
    select g.* into i from public.website_impersonations g join public.website_impersonation_sessions s on s.impersonation_id = g.id
        where s.session_id = native_session_id;
    if i.id is null then return jsonb_build_object('impersonationId', null); end if;
    if i.target_id <> auth.uid() or i.target_session_id is distinct from native_session_id or i.ended_at is not null or i.expires_at <= clock_timestamp()
        or not exists(select 1 from auth.sessions where id = native_session_id and user_id = i.target_id)
        or not exists(select 1 from auth.users u join auth.sessions s on s.user_id = u.id
            where u.id = i.actor_id and s.id = i.actor_session_id and u.raw_app_meta_data->>'role' = 'Admin'
            and u.deleted_at is null and (u.banned_until is null or u.banned_until <= clock_timestamp()))
        then raise insufficient_privilege; end if;
    insert into public.website_impersonation_events(request_id, impersonation_id, action)
        values(p_request_id, i.id, p_action) on conflict do nothing;
    return jsonb_build_object('impersonationId', i.id, 'actorId', i.actor_id,
        'targetId', i.target_id, 'expiresAt', i.expires_at);
end;
$$;

revoke all on function public.website_impersonation_begin(uuid,uuid,uuid,uuid),
    public.website_impersonation_bind(uuid,uuid,uuid,uuid),
    public.website_impersonation_end(uuid,uuid,uuid,uuid),
    public.website_session_context(text,uuid) from public, anon, authenticated;
grant execute on function public.website_impersonation_begin(uuid,uuid,uuid,uuid),
    public.website_impersonation_bind(uuid,uuid,uuid,uuid),
    public.website_impersonation_end(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.website_session_context(text,uuid) to authenticated;
commit;
