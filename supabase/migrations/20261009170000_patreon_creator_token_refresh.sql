begin;

-- Durable Patreon creator token rotation. The access and refresh tokens live in Supabase Vault;
-- this singleton tracks their generation and expiry. The generation is the only fence: the
-- patreon-roles worker already serializes runs through its own lease, so a stale generation
-- means another rotation already landed. Service role only.
create table patreon_roles.creator_token (
    singleton boolean primary key default true check (singleton),
    generation bigint not null default 0 check (generation >= 0),
    access_secret_id uuid,
    refresh_secret_id uuid,
    expires_at timestamptz,
    refreshed_at timestamptz,
    last_failure text check (last_failure in ('rejected', 'unavailable')),
    last_failure_at timestamptz,
    check ((access_secret_id is null) = (refresh_secret_id is null)),
    check ((generation = 0) = (access_secret_id is null))
);
alter table patreon_roles.creator_token enable row level security;
revoke all on patreon_roles.creator_token from public, anon, authenticated, service_role;

create function public.patreon_creator_token(p_operation text, p_input jsonb)
returns jsonb language plpgsql security definer
set search_path = ''
as $function$
declare
    v_row patreon_roles.creator_token%rowtype;
    v_access text;
    v_refresh text;
    v_generation bigint;
    v_expires_in bigint;
    v_reason text;
begin
    if p_input is null or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 16384
        or p_operation is null or p_operation not in ('read', 'seed', 'rotate', 'failed', 'reset') then
        raise exception 'invalid_creator_token_request';
    end if;
    perform set_config('lock_timeout', '2000', true);

    if p_operation = 'read' then
        select * into v_row from patreon_roles.creator_token where singleton;
        if v_row.access_secret_id is null then
            return jsonb_build_object('configured', false, 'generation', 0);
        end if;
        select decrypted_secret into strict v_access from vault.decrypted_secrets where id = v_row.access_secret_id;
        select decrypted_secret into strict v_refresh from vault.decrypted_secrets where id = v_row.refresh_secret_id;
        return jsonb_build_object('configured', true, 'accessToken', v_access, 'refreshToken', v_refresh,
            'generation', v_row.generation,
            'refreshDue', v_row.expires_at is null or v_row.expires_at <= now() + interval '7 days');
    end if;

    insert into patreon_roles.creator_token(singleton) values (true) on conflict do nothing;
    select * into v_row from patreon_roles.creator_token where singleton for update;

    if p_operation = 'reset' then
        -- Operator path after a manual rotation: the next worker call seeds the store from the
        -- function secrets again. Never used by the worker itself.
        delete from vault.secrets where id in (v_row.access_secret_id, v_row.refresh_secret_id);
        delete from patreon_roles.creator_token where singleton;
        return jsonb_build_object('reset', true);
    end if;

    if p_operation = 'seed' then
        v_access := p_input ->> 'accessToken';
        v_refresh := p_input ->> 'refreshToken';
        if v_access is null or length(v_access) not between 16 and 4096 or v_access !~ '^[[:graph:]]+$'
            or v_refresh is null or length(v_refresh) not between 16 and 4096 or v_refresh !~ '^[[:graph:]]+$'
            or v_access = v_refresh then
            raise exception 'invalid_creator_token';
        end if;
        if v_row.generation > 0 then return jsonb_build_object('stale', true, 'generation', v_row.generation); end if;
        update patreon_roles.creator_token set
            access_secret_id = vault.create_secret(v_access, 'patreon_creator_access_token',
                'Patreon creator access token; rotated by the patreon-roles worker'),
            refresh_secret_id = vault.create_secret(v_refresh, 'patreon_creator_refresh_token',
                'Patreon creator refresh token; rotated by the patreon-roles worker'),
            generation = 1, expires_at = null, refreshed_at = null, last_failure = null, last_failure_at = null
            where singleton;
        return jsonb_build_object('seeded', true, 'generation', 1);
    end if;

    v_generation := (p_input ->> 'generation')::bigint;
    if v_generation is null or v_generation < 1 then raise exception 'invalid_creator_token_generation'; end if;
    if v_row.access_secret_id is null then return jsonb_build_object('configured', false, 'generation', 0); end if;
    if v_row.generation <> v_generation then return jsonb_build_object('stale', true, 'generation', v_row.generation); end if;

    if p_operation = 'failed' then
        v_reason := p_input ->> 'reason';
        if v_reason not in ('rejected', 'unavailable') then raise exception 'invalid_creator_token_failure'; end if;
        update patreon_roles.creator_token set last_failure = v_reason, last_failure_at = now() where singleton;
        return jsonb_build_object('recorded', true);
    end if;

    -- rotate: Patreon has already consumed the previous refresh token, so the new pair must be
    -- stored whenever the generation still matches. Both secrets rotate together.
    v_access := p_input ->> 'accessToken';
    v_refresh := p_input ->> 'refreshToken';
    v_expires_in := case when jsonb_typeof(p_input -> 'expiresIn') = 'number' then (p_input ->> 'expiresIn')::bigint end;
    if v_access is null or length(v_access) not between 16 and 4096 or v_access !~ '^[[:graph:]]+$'
        or v_refresh is null or length(v_refresh) not between 16 and 4096 or v_refresh !~ '^[[:graph:]]+$'
        or v_access = v_refresh
        or v_expires_in is null or v_expires_in < 60 or v_expires_in > 366 * 86400 then
        raise exception 'invalid_creator_token';
    end if;
    perform vault.update_secret(v_row.access_secret_id, v_access);
    perform vault.update_secret(v_row.refresh_secret_id, v_refresh);
    update patreon_roles.creator_token set generation = v_generation + 1,
        expires_at = now() + make_interval(secs => v_expires_in), refreshed_at = now(),
        last_failure = null, last_failure_at = null
        where singleton;
    return jsonb_build_object('rotated', true, 'generation', v_generation + 1);
end;
$function$;
revoke all on function public.patreon_creator_token(text, jsonb) from public, anon, authenticated;
grant execute on function public.patreon_creator_token(text, jsonb) to service_role;

commit;
