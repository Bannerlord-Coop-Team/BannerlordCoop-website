import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { ReleaseBuild } from "./types";
import {
    adminActionOptionValue,
    applyControlPlaneOperationDefaults,
    createServerRegionOptions,
    fieldRequirementLabel,
    formatAccountOwner,
    hostPlacementLabel,
    installableBuilds,
    releaseChannelLabel,
    releaseVersion,
    MAINTENANCE_TIME_ZONE,
    maintenanceSlotOptions,
    operationCardRowClass,
    operationCardRows,
    operationTargetMatchesHash,
    overviewStatRowClass,
    presentControlPlaneOperationResult,
    serverLifecycleOperationHref,
} from "./presentation";
import { hostingRegionCatalogPayload } from "../../../../supabase/functions/_shared/hosting-regions";

const entry = (region: string, available: boolean) => ({ region, available });

test("create-server regions are the stored-catalog entries reported available, in stored order, with website labels", () => {
    assert.deepEqual(createServerRegionOptions([
        entry("poland", true), entry("us-west", false), entry("us-east", true), entry("united-states", true),
    ]), [
        { value: "poland", label: "Poland" },
        { value: "us-east", label: "US-East" },
        { value: "united-states", label: "United States" },
    ]);
    assert.deepEqual(createServerRegionOptions([entry("france", false)]), []);
    assert.deepEqual(createServerRegionOptions([]), []);
});

test("administrator create sends only the region key; publishing sends the whole website catalog", () => {
    const input: Record<string, unknown> = { friendlyRegion: "us-east" };
    applyControlPlaneOperationDefaults("create-server", input);
    assert.deepEqual(input, { friendlyRegion: "us-east", releaseChannel: "stable" });
    const publish: Record<string, unknown> = { expectedRevision: 4, reason: "Add Japan" };
    applyControlPlaneOperationDefaults("set-hosting-regions", publish);
    assert.deepEqual(publish, { expectedRevision: 4, reason: "Add Japan", regions: hostingRegionCatalogPayload() });
    assert.equal(presentControlPlaneOperationResult("set-hosting-regions", { revision: 5, regions: [], updatedAt: null, updatedBy: null }).message,
        "Published the website hosting regions as catalog revision 5.");
});

test("hosts are labelled with every stored region they serve, else their legacy region or none", () => {
    const stored = hostingRegionCatalogPayload();
    assert.equal(hostPlacementLabel({ countryCode: "PL", locationId: "os-waw2", region: null }, stored), "Poland · PL · os-waw2");
    assert.equal(hostPlacementLabel({ countryCode: "US", locationId: "us-las", region: "united-states" }, stored), "United States (legacy) · US · us-las");
    assert.equal(hostPlacementLabel({ countryCode: "IT", locationId: "it-mil", region: null }, stored), "No stored region · IT · it-mil");
    assert.equal(hostPlacementLabel({ countryCode: "PL", locationId: "os-waw2", region: null }, null), "Regions unavailable · PL · os-waw2");
    // The stored placements decide, not the website file.
    const custom = [{ region: "central-europe", placement: { countryCodes: ["PL", "CZ"] } }];
    assert.equal(hostPlacementLabel({ countryCode: "CZ", locationId: "any", region: null }, custom), "Central Europe · CZ · any");
});

test("host labels never guess a coast or a country", () => {
    const stored = hostingRegionCatalogPayload();
    for (const host of [
        { countryCode: "US", locationId: "us-las" }, { countryCode: "US", locationId: "US-EAST-VA" },
        { countryCode: "US", locationId: "us-east-va-other" }, { countryCode: "pl", locationId: "os-waw2" },
        { countryCode: "ES", locationId: "es-mad" },
    ]) assert.match(hostPlacementLabel({ ...host, region: null }, stored), /^No stored region · /u, JSON.stringify(host));
    assert.match(hostPlacementLabel({ countryCode: "US", locationId: "us-east-va", region: null }, stored), /^US-East · /u);
    assert.match(hostPlacementLabel({ countryCode: "US", locationId: "us-west-or", region: null }, stored), /^US-West · /u);
});

test("maintenance choices show their authoritative timezone without changing protocol values", () => {
    assert.equal(MAINTENANCE_TIME_ZONE, "America/Chicago");
    assert.deepEqual(maintenanceSlotOptions(), [
        { value: "03:00-04:00", label: "03:00–04:00 America/Chicago" },
        { value: "10:00-11:00", label: "10:00–11:00 America/Chicago" },
        { value: "18:00-19:00", label: "18:00–19:00 America/Chicago" },
    ]);
});

test("the website creates servers on Public without asking for a redundant release choice", async () => {
    const input: Record<string, unknown> = { displayName: "Calradia" };
    applyControlPlaneOperationDefaults("create-server", input);
    assert.deepEqual(input, { displayName: "Calradia", releaseChannel: "stable" });

    const unrelated: Record<string, unknown> = { action: "start" };
    applyControlPlaneOperationDefaults("server-operation", unrelated);
    assert.deepEqual(unrelated, { action: "start" });

    const source = await readFile(
        new URL("../../admin/control-plane/page.tsx", import.meta.url),
        "utf8",
    );
    const createCard = source.match(/operation: "create-server"[\s\S]+?operation: "set-global-controls"/u)?.[0];
    assert.ok(createCard);
    assert.doesNotMatch(createCard, /name: "releaseChannel"/u);
    assert.match(createCard, /New servers use Public by default/u);
});

test("the administrator page omits the retired role-deletion control", async () => {
    const source = await readFile(
        new URL("../../admin/control-plane/page.tsx", import.meta.url),
        "utf8",
    );
    assert.doesNotMatch(source, /roleDeletionsPaused|Role deletions|Pause role deletions/u);
    assert.doesNotMatch(source, /Discord-role reconciliation/u);
    assert.match(source, /Replace all four live pause switches/u);
    assert.match(source, /explicit administrator grant/u);
});

test("operation fields explicitly identify required and optional inputs", () => {
    assert.equal(fieldRequirementLabel(true), "Required");
    assert.equal(fieldRequirementLabel(false), "Optional");
});

test("server ownership resolves the durable website account and has explicit fallbacks", () => {
    const accountId = "44444444-4444-4444-8444-444444444444";
    const legacyId = "763278507085922325";
    const labels = { [accountId]: "owner@example.com", [legacyId]: "wrong@example.com" };
    assert.equal(formatAccountOwner({ ownerDiscordUserId: legacyId, ownerAccountId: accountId }, labels), "owner@example.com");
    assert.equal(formatAccountOwner({ ownerDiscordUserId: accountId, ownerAccountId: accountId }, labels), "owner@example.com");
    assert.equal(formatAccountOwner({ ownerDiscordUserId: accountId }, labels), "owner@example.com");
    assert.equal(formatAccountOwner({ ownerDiscordUserId: legacyId, ownerAccountId: null }, labels), `Legacy owner (${legacyId})`);
    assert.equal(formatAccountOwner({ ownerDiscordUserId: legacyId }, labels), `Legacy owner (${legacyId})`);
    assert.equal(formatAccountOwner({ ownerDiscordUserId: legacyId, ownerAccountId: accountId }, {}), `Account unavailable (${accountId})`);
});

test("the VPS view presents slot occupants and resources with their owning host", async () => {
    const pageSource = await readFile(
        new URL("../../admin/control-plane/page.tsx", import.meta.url),
        "utf8",
    );
    const inventorySource = await readFile(
        new URL("../../components/admin/VpsHostInventory.tsx", import.meta.url),
        "utf8",
    );

    assert.match(pageSource, /needsAccounts = view === "vps"/u);
    const vpsSource = await readFile(new URL("../../components/admin/VpsView.tsx", import.meta.url), "utf8");
    assert.match(vpsSource, /<HostResourcesCard name="Oracle control plane" resources=\{controlPlaneHost\}/u);
    assert.match(vpsSource, /<VpsHostInventory/u);
    assert.match(inventorySource, /formatAccountOwner\(slot, ownerLabels\)/u);

    assert.match(inventorySource, /view=server&serverId=\$\{encodeURIComponent\(slot\.serverId\)\}/u);
    assert.match(inventorySource, /usedPercent >= 90 \? "critical" : usedPercent >= 80 \? "warning"/u);
});

test("administrator reason fields are optional and explain the audit fallback", async () => {
    const source = await readFile(
        new URL("../../admin/control-plane/page.tsx", import.meta.url),
        "utf8",
    );
    const declaration = source.match(/const reasonField: AdminActionField = \{[^\n]+\};/u)?.[0];

    assert.ok(declaration);
    assert.doesNotMatch(declaration, /required: true/u);
    assert.match(declaration, /Optional context/u);
    assert.match(declaration, /fixed portal-action reason/u);
});

test("operation deep links match their rendered card after hydration", () => {
    assert.equal(operationTargetMatchesHash("#onboard-vps-host", "onboard-vps-host"), true);
    assert.equal(operationTargetMatchesHash("#onboard%2Dvps%2Dhost", "onboard-vps-host"), true);
    assert.equal(operationTargetMatchesHash("#create-server", "onboard-vps-host"), false);
    assert.equal(operationTargetMatchesHash("#%E0%A4%A", "onboard-vps-host"), false);
});

test("server rows deep-link to a highlighted lifecycle operation", () => {
    const serverId = "11111111-1111-4111-8111-111111111111";
    assert.equal(
        serverLifecycleOperationHref(serverId),
        `/admin/control-plane?view=operations&serverId=${serverId}#server-operation`,
    );
    assert.equal(
        adminActionOptionValue("server", { value: serverId, updatedAt: "2026-09-02T15:00:00.000Z" }),
        JSON.stringify({ id: serverId, updatedAt: "2026-09-02T15:00:00.000Z" }),
    );
});

test("create-server success explains stopped state without hiding its one-time password", () => {
    const serverId = "11111111-1111-4111-8111-111111111111";
    const presented = presentControlPlaneOperationResult("create-server", {
        outcome: "assigned",
        generatedPassword: "one-time-password",
        job: null,
        server: {
            serverId,
            displayName: "Calradia",
            operationState: "stopped",
        },
    });

    assert.match(presented.message, /created in stopped state/iu);
    assert.match(presented.message, /does not start Bannerlord/iu);
    assert.match(presented.message, /one-time-password/u);
    assert.deepEqual(presented.links, [
        {
            href: `/admin/control-plane?view=server&serverId=${serverId}`,
            label: "View server status",
        },
        {
            href: "/admin/control-plane?view=operations#server-operation",
            label: "Open lifecycle controls",
        },
    ]);
});

test("durable job success exposes live progress destinations", () => {
    const serverId = "11111111-1111-4111-8111-111111111111";
    const jobId = "22222222-2222-4222-8222-222222222222";
    const presented = presentControlPlaneOperationResult("server-operation", {
        job: {
            jobId,
            serverId,
            action: "start",
            state: "queued",
            progressStage: "queued",
        },
    });

    assert.equal(
        presented.message,
        `start job ${jobId} is queued at queued. Progress refreshes automatically on its server and Jobs pages.`,
    );
    assert.deepEqual(presented.links, [
        {
            href: `/admin/control-plane?view=server&serverId=${serverId}`,
            label: "View server status",
        },
        {
            href: `/admin/control-plane?view=jobs&serverId=${serverId}`,
            label: "Track job progress",
        },
    ]);
});

test("result links reject untrusted non-UUID identifiers", () => {
    const presented = presentControlPlaneOperationResult("server-operation", {
        job: { jobId: "../job", serverId: "javascript:alert(1)" },
    });

    assert.deepEqual(presented.links, []);
});

function build(buildId: string, validationState: string, sourceRevision: string): ReleaseBuild {
    return {
        buildId,
        channel: "nightly",
        version: buildId,
        sourceRevision,
        supportedGameVersion: "v1.2.12",
        validationState,
        publishedAt: "2026-08-27T00:00:00.000Z",
        updatedAt: "2026-08-27T00:00:00.000Z",
    };
}

// Protect registry-only selection while retaining honest historical version display.
test("only verified registry versions are selectable; historical versions are not fabricated", () => {
    const historical = { ...build("ghcr-stable-35b1b6ebeb038a5a69f4ef8a2a84031c3726702452e38874fd4b2f339de92203", "validated", "registry-observed"), version: "stable-35b1b6ebeb03" };
    const registry = { ...build("transport-key", "validated", "a".repeat(40)), channel: "stable" as const, requiredClientModVersion: "v0.1.5",
        registryMetadata: { versionTag: "v0.1.5-client12345678-serverabcdefgh", clientRevision: "a".repeat(40), serverRevision: "b".repeat(40) }, currentChannel: true };
    assert.deepEqual(installableBuilds([historical, registry, { ...registry, validationState: "revoked" }]), [registry]);
    assert.equal(releaseVersion(registry), registry.registryMetadata.versionTag);
    assert.equal(releaseVersion(historical), "stable-35b1b6ebeb03");
    assert.equal(releaseChannelLabel("stable"), "Public");
    assert.equal(releaseChannelLabel("nightly"), "Nightly");
});

test("nightly names use the client version label with one v prefix", () => {
    const nightly = {
        ...build("immutable-build-id", "validated", "a".repeat(40)),
        registryMetadata: { versionTag: "nightly-serverhash-clienthash-digest", clientRevision: "a".repeat(40), serverRevision: "b".repeat(40) },
    };

    assert.equal(releaseVersion({ ...nightly, requiredClientModVersion: "v0.1.6" }), "v0.1.6");
    assert.equal(releaseVersion({ ...nightly, requiredClientModVersion: "0.1.6" }), "v0.1.6");
    assert.equal(releaseVersion(nightly), nightly.registryMetadata.versionTag);
    assert.equal(releaseVersion({ ...nightly, requiredClientModVersion: "" }), nightly.registryMetadata.versionTag);
    assert.equal(releaseVersion(build("historical-nightly", "validated", "a".repeat(40))), "historical-nightly");
});

test("overview statistic cards fill the final row evenly", () => {
    assert.equal(overviewStatRowClass(1), "grid-cols-1");
    assert.match(overviewStatRowClass(2), /sm:grid-cols-2/u);
    assert.match(overviewStatRowClass(3), /lg:grid-cols-3/u);
    assert.match(overviewStatRowClass(4), /lg:grid-cols-4/u);
    assert.throws(() => overviewStatRowClass(0));
    assert.throws(() => overviewStatRowClass(5));
});

test("operation cards group similar input density into balanced rows", () => {
    const cards = [
        { operation: "onboard", fields: Array.from({ length: 7 }) },
        { operation: "create", fields: Array.from({ length: 6 }) },
        { operation: "force", fields: [] },
        { operation: "review", fields: [] },
        { operation: "open-review", fields: [true] },
        { operation: "cleanup", fields: Array.from({ length: 3 }) },
        { operation: "controls", fields: Array.from({ length: 6 }) },
    ];

    assert.deepEqual(
        operationCardRows(cards).map((row) => row.map((card) => card.operation)),
        [
            ["onboard", "create"],
            ["controls", "cleanup"],
            ["open-review", "force", "review"],
        ],
    );
    assert.deepEqual(
        operationCardRows([
            { operation: "retry", fields: [true, true] },
            { operation: "cancel", fields: [true, true] },
            { operation: "diagnostics", fields: [true] },
        ]).map((row) => row.map((card) => card.operation)),
        [["retry", "cancel"], ["diagnostics"]],
    );
});

test("a prioritized lifecycle card remains first without occupying its own row", () => {
    const cards = [
        { operation: "lifecycle", layoutPriority: 1, fields: Array.from({ length: 3 }) },
        { operation: "replace", fields: Array.from({ length: 6 }) },
        { operation: "settings", fields: Array.from({ length: 4 }) },
        { operation: "backup", fields: Array.from({ length: 2 }) },
    ];

    assert.deepEqual(
        operationCardRows(cards).map((row) => row.map((card) => card.operation)),
        [["lifecycle", "replace"], ["settings", "backup"]],
    );
});

test("fleet onboarding and server creation remain paired after onboarding becomes one-click", () => {
    const cards = [
        { operation: "onboard", fields: [true] },
        { operation: "create", fields: Array.from({ length: 5 }) },
        { operation: "controls", fields: Array.from({ length: 6 }) },
        { operation: "force", fields: [] },
    ];

    assert.deepEqual(
        operationCardRows(cards, 2).map((row) => row.map((card) => card.operation)),
        [["onboard", "create"], ["controls"], ["force"]],
    );
});

test("failed and legacy runner rows expose the typed service-only onboarding action", async () => {
    const source = await readFile(
        new URL("../../components/admin/RunnerOnboardingStatus.tsx", import.meta.url),
        "utf8",
    );

    assert.match(source, /operation: "onboard-vps-host"/u);
    assert.match(source, /input: \{ serviceName, mode: onboarding === null \? "enroll" : "retry" \}/u);
    assert.match(source, /Retry onboarding/u);
    assert.match(source, /Onboard runner/u);
    assert.doesNotMatch(source, /hostPublicKey/u);
});

test("operation card rows expand to their row width", () => {
    assert.equal(operationCardRowClass(1), "grid-cols-1");
    assert.match(operationCardRowClass(2), /md:grid-cols-2/u);
    assert.match(operationCardRowClass(3), /xl:grid-cols-3/u);
    assert.throws(() => operationCardRowClass(0));
    assert.throws(() => operationCardRowClass(4));
});

// Ensure discovery replaces receipt import and renders backend metadata rather than legacy guesses.
test("Builds refreshes GHCR discovery and displays exact release labels", async () => {
    const source = await readFile(new URL("../../admin/control-plane/page.tsx", import.meta.url), "utf8");
    assert.match(source, /<RefreshReleaseCatalog/u);
    assert.doesNotMatch(source, /import-latest-stable|LEGACY_STABLE_METADATA/u);
    for (const key of ["client.revision", "client.version", "dedicated-server.revision", "game.version"]) {
        assert.ok(source.includes(`io.bannerlordcoop.${key}`));
    }
    assert.match(source, /build.currentChannel/u);
    assert.ok(source.includes('build.registryMetadata ? "First observed" : "Published"'));
    assert.match(source, /Follow channel \(remove version pin\)/u);
    assert.match(source, /RecordedRelease build=\{result.dashboard.installedBuild\}/u);
});

// Operations must offer the full discovery bound, not the overview's truncated 20-version lists.
test("release selectors load the same full catalog as the Releases view", async () => {
    const source = await readFile(new URL("../../admin/control-plane/page.tsx", import.meta.url), "utf8");
    const operations = source.slice(source.indexOf('case "operations":'), source.indexOf('case "vps":'));
    assert.match(operations, /operation: "overview", input: \{ operations: true \}/u);
    assert.match(operations, /loadReleaseCatalog\(token, signal, identity\)/u);
    assert.match(operations, /stableBuilds: releases.stable, nightlyBuilds: releases.nightly/u);
});
