begin;

-- Service-only administrator preview. Unlike membership_status, this function
-- must never fence identity drift, initialize state, or enqueue reconciliation.
create function public.membership_preview_status(p_account_id uuid, p_discord_user_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    h public.membership_heads;
    current_patreon text;
    snapshot jsonb;
begin
    select * into h from public.membership_heads where account_id = p_account_id;
    select patreon_user_id into current_patreon from public.patreon_accounts where user_id = p_account_id;
    if h.account_id is null and current_patreon is null then
        snapshot := jsonb_build_object('version', 1, 'accountId', p_account_id,
            'discordUserId', p_discord_user_id, 'patreonUserId', null,
            'linkGeneration', '0', 'revision', '0', 'linkState', 'unlinked') || public.membership_empty_evidence();
    elsif h.account_id is not null and h.link_state <> 'account_deleted'
        and h.discord_user_id is not distinct from p_discord_user_id
        and h.patreon_user_id is not distinct from current_patreon then
        snapshot := public.membership_snapshot_json(h);
    else
        -- An ordinary login must reconcile drift. Preview reports unavailable
        -- instead of changing the account or displaying stale verified evidence.
        return null;
    end if;
    return jsonb_build_object('snapshot', snapshot,
        'pending', exists(select 1 from public.membership_outbox where account_id = p_account_id and receipt_id is null),
        'verificationPending', exists(select 1 from public.patreon_oauth_states where user_id = p_account_id
            and expected_generation = (snapshot->>'linkGeneration')::bigint and expires_at > statement_timestamp()));
end;
$$;
revoke all on function public.membership_preview_status(uuid, text) from public, anon, authenticated;
grant execute on function public.membership_preview_status(uuid, text) to service_role;
commit;
