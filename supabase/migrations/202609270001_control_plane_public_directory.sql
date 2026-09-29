begin;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Preserve only the latest explicit Public choice made by the current owner.
-- Unproven inherited values become visibly Private so the owner can opt in again.
CREATE INDEX hosting_visibility_receipts_server_time
    ON control_plane.hosting_server_visibility_receipts (server_id, updated_at DESC);
UPDATE control_plane.managed_servers SET visibility = 'private', updated_at = to_char((updated_at::timestamptz + interval '1 millisecond') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE visibility = 'public' AND NOT EXISTS (
    SELECT 1 FROM control_plane.hosting_server_visibility_receipts r
    WHERE r.server_id = control_plane.managed_servers.server_id
      AND r.actor_id = control_plane.managed_servers.owner_discord_user_id AND r.visibility = 'public'
      AND r.updated_at = (SELECT MAX(latest.updated_at) FROM control_plane.hosting_server_visibility_receipts latest
                         WHERE latest.server_id = r.server_id)
);
CREATE INDEX managed_servers_public_directory ON control_plane.managed_servers (guild_id, created_at, server_id)
    WHERE visibility = 'public' AND soft_deleted_at IS NULL;

CREATE FUNCTION control_plane.withdraw_public_visibility_on_transfer() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    NEW.visibility := 'private';
    IF NEW.updated_at <= OLD.updated_at THEN
        NEW.updated_at := to_char((OLD.updated_at::timestamptz + interval '1 millisecond') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION control_plane.withdraw_public_visibility_on_transfer() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER managed_servers_withdraw_public_on_transfer
BEFORE UPDATE OF owner_discord_user_id ON control_plane.managed_servers
FOR EACH ROW WHEN (NEW.owner_discord_user_id IS DISTINCT FROM OLD.owner_discord_user_id)
EXECUTE FUNCTION control_plane.withdraw_public_visibility_on_transfer();

insert into control_plane.schema_migrations (version, applied_at)
values ('088_managed_hosting_public_directory.sql', '2026-09-27T00:01:00.000Z');
commit;
