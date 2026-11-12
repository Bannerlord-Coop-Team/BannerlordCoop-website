begin;

-- Operator mail only. Preserve v1/v2 and batch contact resolution for their
-- bounded candidate set; retained Auth rows also resolve deleted accounts.
create or replace function public.patreon_lapse_report_inventory_v3()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
with inventory as materialized (
    select public.patreon_lapse_report_inventory_v2() as data
), contacts as materialized (
    select u.id, nullif(btrim(u.email), '') as email
    from auth.users u
    join (
        select distinct (entry ->> 'account_id')::uuid as account_id
        from inventory, jsonb_array_elements(data -> 'servers') entry
    ) accounts on accounts.account_id = u.id
), report_rows as (
    select entry || jsonb_build_object('account_email', c.email) as data, position
    from inventory,
        jsonb_array_elements(data -> 'servers') with ordinality as rows(entry, position)
    left join contacts c on c.id = (entry ->> 'account_id')::uuid
)
select data || jsonb_build_object(
    'version', 3,
    'servers', coalesce((select jsonb_agg(data order by position) from report_rows), '[]'::jsonb)
)
from inventory;
$function$;

revoke all on function public.patreon_lapse_report_inventory_v3() from public, anon, authenticated;
grant execute on function public.patreon_lapse_report_inventory_v3() to service_role;

commit;
