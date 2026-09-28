BEGIN;

-- Widen only the numeric owner-key constraints; retain all other constraints.

DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT c.conname, t.relname, a.attname, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = c.conkey[1]
    WHERE n.nspname = 'control_plane' AND c.contype = 'c'
      AND cardinality(c.conkey) = 1
      AND t.relname IN ('hosting_entitlements', 'server_access', 'hosting_notifications', 'hosting_wizard_sessions', 'hosting_provider_orphan_review_groups', 'hosting_provider_resource_generations', 'managed_servers', 'audit_events', 'hosting_server_visibility_receipts')
      AND a.attname IN ('discord_user_id','owner_discord_user_id','tag_owner_discord_user_id','target_discord_user_id','actor_id')
      AND pg_get_constraintdef(c.oid) LIKE '%20%'
  LOOP
    EXECUTE format('ALTER TABLE control_plane.%I DROP CONSTRAINT %I', item.relname, item.conname);
    EXECUTE format('ALTER TABLE control_plane.%I ADD CONSTRAINT %I CHECK ((%s) OR %I ~ %L)',
      item.relname, item.conname, substring(item.definition FROM 7), item.attname,
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  END LOOP;
END $$;

CREATE TABLE control_plane.hosting_website_accounts (
    account_id TEXT PRIMARY KEY CHECK (account_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    principal_id TEXT NOT NULL UNIQUE CHECK (principal_id ~ '^[0-9]{17,20}$' OR principal_id = account_id),
    created_at TEXT NOT NULL
);
ALTER TABLE control_plane.hosting_website_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON control_plane.hosting_website_accounts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON control_plane.hosting_website_accounts FROM bannerlord_control_plane_runtime;
GRANT SELECT, INSERT ON control_plane.hosting_website_accounts TO bannerlord_control_plane_runtime;
CREATE POLICY runtime_website_account_read ON control_plane.hosting_website_accounts FOR SELECT TO bannerlord_control_plane_runtime USING (true);
CREATE POLICY runtime_website_account_insert ON control_plane.hosting_website_accounts FOR INSERT TO bannerlord_control_plane_runtime WITH CHECK (true);
-- Freeze existing verified Auth-to-hosting ownership at cutover, before unlinking.
-- Multiple accounts claiming one legacy principal fail the UNIQUE constraint.
WITH claims AS (
 SELECT user_id::text AS account_id, min(provider_id) AS principal_id
 FROM auth.identities WHERE provider = 'discord' AND provider_id ~ '^[0-9]{17,20}$'
 GROUP BY user_id HAVING count(DISTINCT provider_id) = 1
)
INSERT INTO control_plane.hosting_website_accounts(account_id, principal_id, created_at)
SELECT account_id, principal_id, '2026-09-28T00:01:00.000Z' FROM claims
WHERE EXISTS (SELECT 1 FROM control_plane.hosting_entitlements e WHERE e.discord_user_id = principal_id)
   OR EXISTS (SELECT 1 FROM control_plane.server_access a WHERE a.discord_user_id = principal_id);
DROP INDEX control_plane.hosting_membership_owner_binding;
INSERT INTO control_plane.schema_migrations(version, applied_at)
VALUES ('089_managed_hosting_website_accounts.sql', '2026-09-28T00:01:00.000Z');

COMMIT;
