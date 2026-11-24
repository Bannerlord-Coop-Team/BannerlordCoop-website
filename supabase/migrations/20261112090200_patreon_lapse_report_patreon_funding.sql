begin;

-- The Patreon lapse report covers Patreon funding only. Since control-plane migration 129 added
-- provider columns, a server funded by another provider's membership has a non-Patreon
-- hosting_subscription_grace row, and an account may hold non-Patreon membership sources. Such a
-- server is not a Patreon lapse, so it is left out of the report, and verification is read from the
-- account's Patreon source only. For an account with only Patreon funding and sources every row is
-- unchanged, as are the signature, classifications, grant notes, row bounds and service-role-only
-- access. Apply after control-plane migration 129 (20261109130000_control_plane_funding_providers.sql),
-- which adds the provider columns read here.
create or replace function public.patreon_lapse_report_inventory_v2()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
with candidates as materialized (
    select s.server_id, s.guild_id, s.owner_discord_user_id, s.soft_deleted_at, s.operation_state
    from control_plane.managed_servers s
    where s.soft_deleted_at is null
       or s.soft_deleted_at::timestamptz >= statement_timestamp() - interval '24 hours'
    order by s.server_id
    limit 1001
), owners as materialized (
    select distinct guild_id, owner_discord_user_id from candidates
), grant_audits as materialized (
    select * from public.patreon_lapse_report_grants(
        (select case when bool_or(coalesce(e.base_quota, 0) + coalesce(e.bonus_quota, 0) > 0) then true else null end
         from owners o left join control_plane.hosting_entitlements e
           on e.guild_id = o.guild_id and e.discord_user_id = o.owner_discord_user_id)
    )
), owner_facts as materialized (
    select o.guild_id, o.owner_discord_user_id,
        coalesce(e.base_quota, 0) + coalesce(e.bonus_quota, 0) as independent_quota,
        (select count(*) from control_plane.managed_servers s
         where s.guild_id = o.guild_id and s.owner_discord_user_id = o.owner_discord_user_id
           and s.soft_deleted_at is null and s.operation_state <> 'deleted')
        + (select count(distinct a.server_id) from control_plane.hosting_role_restoration_authorizations a
           join control_plane.hosting_jobs j on j.job_id = a.restoration_job_id
           join control_plane.managed_servers s on s.server_id = a.server_id
           where s.guild_id = o.guild_id and s.owner_discord_user_id = o.owner_discord_user_id
             and a.consumed_at is null and a.invalidated_at is null
             and j.state in ('queued', 'running', 'retry-wait')) as owner_usage,
        grant_audit.reason as grant_reason, coalesce(grant_audit.occurred_at, e.updated_at) as grant_recorded_at
    from owners o
    left join control_plane.hosting_entitlements e
      on e.guild_id = o.guild_id and e.discord_user_id = o.owner_discord_user_id
    left join grant_audits grant_audit on grant_audit.owner_id = o.owner_discord_user_id
      and coalesce(e.base_quota, 0) + coalesce(e.bonus_quota, 0) > 0
), report_rows as (
    select s.server_id, jsonb_build_object(
        -- A tombstone has no server detail view even if its deletion timestamp is absent.
        'server_id', case when s.operation_state = 'deleted' then null else s.server_id::uuid end,
        'account_id', w.account_id::uuid,
        'server_prefix', left(s.server_id, 8),
        'account_prefix', left(w.account_id, 8),
        'patreon_user_id', p.patreon_user_id,
        'deleted_at', s.soft_deleted_at,
        'independent_quota', f.independent_quota,
        'owner_usage', f.owner_usage,
        'funding_recorded', g.server_id is not null,
        'grace_due_at', case when g.grace_id is not null then g.due_at else null end,
        'verification', m.snapshot_json::jsonb ->> 'verification',
        'grant_reason', f.grant_reason,
        'grant_recorded_at', f.grant_recorded_at
    ) as data
    from candidates s
    join owner_facts f on f.guild_id = s.guild_id and f.owner_discord_user_id = s.owner_discord_user_id
    left join control_plane.hosting_website_accounts w on w.principal_id = s.owner_discord_user_id
    left join public.patreon_accounts p on p.user_id::text = w.account_id
    left join control_plane.hosting_subscription_grace g on g.server_id = s.server_id and g.owner_id = s.owner_discord_user_id
    left join lateral (
        select source.snapshot_json from control_plane.hosting_membership_sources source
        where source.account_id = w.account_id and source.guild_id = s.guild_id and source.provider = 'patreon'
          and (g.server_id is null or source.campaign_key = g.campaign_id)
        order by source.updated_at desc, source.campaign_key limit 1
    ) m on true
    -- A server funded through another provider is outside the Patreon report.
    where g.server_id is null or g.provider = 'patreon'
    order by s.server_id limit 1000
)
select jsonb_build_object(
    'version', 2,
    'observed_at', to_char(statement_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'truncated', (select count(*) > 1000 from candidates),
    'servers', coalesce((select jsonb_agg(data order by server_id) from report_rows), '[]'::jsonb)
);
$function$;

revoke all on function public.patreon_lapse_report_inventory_v2() from public, anon, authenticated;
grant execute on function public.patreon_lapse_report_inventory_v2() to service_role;

commit;
