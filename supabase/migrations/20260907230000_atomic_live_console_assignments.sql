begin;

-- Console edits must never replay a previously read role or Patreon marker.
-- Each request changes only the specified server's owner/operator assignment,
-- merging into current metadata under the same Auth row lock as role projection.
create function public.set_live_console_assignment(
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
    if p_user_id is null or p_server_id is null
        or p_server_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
        or (p_owner_assigned is null and p_operator_assigned is null) then
        raise exception 'invalid_console_assignment';
    end if;
    select coalesce(raw_app_meta_data, '{}'::jsonb) into v_original
        from auth.users where id = p_user_id for no key update;
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

revoke all on function public.set_live_console_assignment(uuid, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.set_live_console_assignment(uuid, text, boolean, boolean) to service_role;

comment on function public.set_live_console_assignment(uuid, text, boolean, boolean) is
    'Service-only console assignment mutation. Server actions authorize the actor and catalog server; this function preserves current role and grant metadata.';

commit;
