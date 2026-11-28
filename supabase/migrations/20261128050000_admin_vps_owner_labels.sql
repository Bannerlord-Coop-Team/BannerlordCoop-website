begin;

create function public.admin_vps_owner_labels(p_account_ids uuid[])
returns table (account_id uuid, label text)
language sql stable security definer
set search_path = ''
as $$
    select u.id, coalesce(nullif(btrim(u.email), ''), (
        select min(i.provider_id)
        from auth.identities i
        where i.user_id = u.id and i.provider = 'discord'
          and i.provider_id ~ '^[1-9][0-9]{16,19}$'
    ))
    from auth.users u
    where cardinality(p_account_ids) <= 1000
      and u.id = any(p_account_ids) and u.deleted_at is null;
$$;

revoke all on function public.admin_vps_owner_labels(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_vps_owner_labels(uuid[]) to service_role;

commit;
