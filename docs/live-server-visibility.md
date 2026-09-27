# Live-console mapping and visibility setup

A live-only server's header links to **Set up visibility** in Settings. Missing
mapping, an inaccessible mapped record, and a failed managed lookup have distinct
guidance. A failed lookup means visibility is unknown; reload the same server
page rather than creating another record or assuming it is private.

Use the existing [managed identity setup](live-server-console-design.md#managed-server-identity)
to configure the server-only `CONSOLE_SERVER_CATALOG[].managedServerId` for this
exact game server. The authenticated `listAllMyServers` response must contain
that UUID. Without an explicit mapping, the existing same-ID match remains
supported. Never substitute another server owned by the user. A standalone
server needs the reviewed enrollment/migration procedure first; adding a catalog
UUID or creating a new server does not adopt its running process or saves.

The mapped record is the authority for visibility, managed access role, and
`updatedAt` in both the header and Settings. Only its current managed owner may
submit the existing `set-server-visibility` action; live console ownership,
operator access, managed manager access, and administrative visibility alone do
not confer that permission. The backend rechecks ownership, concurrency and the
idempotency key. Successful acknowledgement triggers a refresh: the refreshed
record, not a potentially replayed mutation receipt, synchronizes both controls.

Mapping does not publish a server, grant management access, or alter game
connection permissions. Preview servers and `/servers/wireframe` remain demos.
No new backend, schema, production catalog mapping or deployment is required by
this website change. Component checks exercise onboarding navigation, exact
mapped identities, owner-only controls, and refresh synchronization using mocked
service responses; they do not prove a production mapping or public listing.
The [public-directory backend requirement](server-visibility.md) still applies: a
successful owner visibility update does not by itself establish anonymous
listing availability or prove that this server appears in the directory.
