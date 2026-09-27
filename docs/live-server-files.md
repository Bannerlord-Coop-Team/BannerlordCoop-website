# Save and configuration transfers for live-console servers

The Save & config tab uses the existing managed file API once this exact live
server resolves to an authorized managed record. Live console ownership or
operator access does not grant managed file access.

Follow the existing [managed identity setup](live-server-console-design.md#managed-server-identity)
and [migration and access procedure](live-server-backups.md#connect-an-existing-server)
to configure the server-only `CONSOLE_SERVER_CATALOG[].managedServerId`. Verify
the campaign, storage and assigned resource before linking the managed UUID.
Creating a new managed server does not adopt a standalone container or copy its
saves. Stop the old writer and use the supported migration procedure; never let
two controllers write the same campaign. No browser-supplied mapping is accepted.

Without a resolved record, the tab explains enrollment, mapping and managed
owner/manager access. An inaccessible explicit link never falls back to another
server. A lookup failure instead offers a page reload and does not claim files
are missing. These states submit no provisioning or transfer requests.

With authorized managed access, the existing `ManagedServerFiles` and
`ManagedServerTransfers` display the active campaign name and managed
configuration returned by `getMyServerFiles` for the resolved UUID:

- Only owners can export the latest completed save while running,
  stopped or awaiting a save, when an active save exists.
- Save import requires the server to be stopped and adds a separate campaign;
  it does not replace or select over the current campaign.
- Owners and managers can export configuration. Only the managed owner can
  import supported configuration after reviewing the changes.
- Existing confirmations, file validation, state restrictions, stale-request
  checks, request recovery and authorization remain enforced by the existing
  components, server actions and backend. Unavailable file status disables
  transfers; admin/support access does not fetch private file data.
- Fictional previews and `/servers/wireframe` remain non-operational demos.

The page file tests exercise this mapping through the real transfer UI and
server actions with mocked service responses, including exact managed UUID,
current save/config display, role/state restrictions and import review. Existing
transfer/API tests cover validation and durable recovery. This is synthetic
local evidence, not proof of a production migration or live transfer. Deployment,
catalog changes and moving a campaign require a separately authorized rollout.
