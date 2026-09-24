# Backups for live-console servers

The Backups tab on `/servers/[serverId]` uses the existing managed backup history,
create and save-only restore flow when the live catalog resolves to a managed
server the current account can access. This completes the mapping/onboarding path
in [ControlPlane #191](https://github.com/Bannerlord-Coop-Team/BannerlordCoop.ControlPlane/issues/191).

## Connect an existing server

Follow the [managed identity setup](live-server-console-design.md#managed-server-identity)
to configure `CONSOLE_SERVER_CATALOG[].managedServerId`. Resolve the exact game
server, assigned resource generation, agent and save storage before mapping it.
The managed UUID must identify this server's campaign, not another server owned
by the same person or another slot on its host. The mapping also enables other
managed capabilities; it is not a backup-only alias.

If the server is not managed, use the control-plane's reviewed
[enrollment and assignment procedure](https://github.com/Bannerlord-Coop-Team/BannerlordCoop.ControlPlane/blob/main/docs/managed-hosting/managed-agent-service.md)
and [backup/restore runbook](https://github.com/Bannerlord-Coop-Team/BannerlordCoop.ControlPlane/blob/main/docs/managed-hosting/backup-restore.md)
to plan its migration. A standalone Docker console agent cannot perform managed
backups. Registering inventory or creating a database record does not adopt its
container, and two controllers must never write the same live save. Establish
the new managed assignment and transfer a preserved save through supported save
import with the old writer safely stopped before switching service. Website
setup creates a separate server; it does not migrate the existing campaign.

Grant the intended users managed owner or manager access using the existing
supported access workflow. Live console owner/operator/admin access is separate.
The catalog is server-only configuration deployed through the usual reviewed
website rollout, never a browser-supplied UUID or an automatic ownership grant.

## User experience and safety

- Without a resolved managed record, the tab explains the administrator-assisted
  enrollment, mapping and access steps and links to the existing server directory
  and setup options. It submits no backup, restore or provisioning request.
- If an explicit mapping is inaccessible, the tab asks the administrator to
  verify both that link and the user's managed access without falling back to a
  different server. A failed managed lookup has a separate reload message and
  does not claim backups are missing or ask the user to create another server.
- Owners and managers see actual managed history and durable job status through
  `ManagedServerFiles` / `ManagedServerBackups`. Admin/support views remain
  read-only and do not fetch private history. Same-ID managed matching still
  works when no explicit mapping is configured.
- Backup and restore retain authentication at submission, managed authorization,
  generation checks, exact-request recovery and idempotency, restore confirmation,
  busy-state restrictions and existing job polling. A backup/status load failure
  blocks submission. Restore remains save-only with expiry/build compatibility
  checks, safe stop and validation owned by the control plane.
- Fictional previews and `/servers/wireframe` remain non-operational demos.

## Verification and rollout boundary

The page component tests exercise mapped history/status requests and real backup
UI/server-action dispatch with mocked service responses. They verify the managed
UUID, authorization separation, restore confirmation, progress refresh, missing
mapping/access, lookup failure, private read-only views and preview isolation.
The existing backup component suite covers durable retry, progress and safety
behavior. These are local synthetic checks, not live backup/restore evidence.

No backend, schema or agent protocol change is required. This change does not
enroll a host, migrate a campaign, edit production catalog mappings or deploy the
website. Before a separately authorized rollout, verify the exact mapped resource,
current ownership, save provenance and rollback target. After rollout, validate
history and a backup on that exact resource with an authorized account, and denial
with an unrelated account. Any live restore needs explicit authorization for the
chosen server and backup and the existing restore safety gates.
