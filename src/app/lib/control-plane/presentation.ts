import type { HostingAdminVpsHost, ReleaseBuild } from "@/app/lib/control-plane/types";

const SERVER_REGION_LABELS = {
    "us-west": "US-West",
    "us-east": "US-East",
    france: "France",
    germany: "Germany",
    "united-kingdom": "United Kingdom",
    poland: "Poland",
} as const;

const MAINTENANCE_SLOTS = ["03:00-04:00", "10:00-11:00", "18:00-19:00"] as const;

const LEGACY_STABLE_METADATA = {
    "ghcr-stable-35b1b6ebeb038a5a69f4ef8a2a84031c3726702452e38874fd4b2f339de92203": {
        storedVersion: "stable-35b1b6ebeb03",
        version: "v0.1.5",
        supportedGameVersion: "v1.4.8",
    },
    "ghcr-stable-c995ff97ce3c6cfe1b175f0586f90593892606b4f7ec182c9390b3903dd2d526": {
        storedVersion: "stable-c995ff97ce3c",
        version: "v0.1.5",
        supportedGameVersion: "v1.4.8",
    },
} as const;

export const MAINTENANCE_TIME_ZONE = "America/Chicago";

export type ControlPlaneOperationResultLink = {
    href: string;
    label: string;
};

export type ControlPlaneOperationResultPresentation = {
    message: string;
    links: ControlPlaneOperationResultLink[];
};

export function installableBuilds(builds: readonly ReleaseBuild[]) {
    return builds.filter((build) => build.validationState === "validated");
}

export function releaseRevision(build: ReleaseBuild) {
    const digest = /^ghcr-stable-([a-f\d]{64})$/u.exec(build.buildId)?.[1];
    return build.sourceRevision === "registry-observed" && digest
        ? digest
        : build.sourceRevision;
}

export function releaseVersion(build: ReleaseBuild) {
    return legacyStableMetadata(build)?.version ?? build.version;
}

export function releaseGameVersion(build: ReleaseBuild) {
    return legacyStableMetadata(build)?.supportedGameVersion ?? build.supportedGameVersion;
}

function legacyStableMetadata(build: ReleaseBuild) {
    const metadata = LEGACY_STABLE_METADATA[
        build.buildId as keyof typeof LEGACY_STABLE_METADATA
    ];
    return build.channel === "stable"
        && build.sourceRevision === "registry-observed"
        && build.supportedGameVersion === "unknown"
        && metadata?.storedVersion === build.version
        ? metadata
        : undefined;
}

export function fieldRequirementLabel(required: boolean) {
    return required ? "Required" : "Optional";
}

export function formatDiscordOwner(username: string | undefined, discordUserId: string) {
    return `${username ?? "Username unavailable"} (${discordUserId})`;
}

export function serverRegionOptions() {
    return Object.entries(SERVER_REGION_LABELS).map(([value, label]) => ({ value, label }));
}

export function createServerRegionOptions(
    hosts: readonly Pick<HostingAdminVpsHost, "region" | "availableServers">[],
) {
    const regionsWithAvailableCapacity = new Set(
        hosts
            .filter((host) => Number.isSafeInteger(host.availableServers) && host.availableServers > 0)
            .map((host) => host.region)
            .filter((region): region is keyof typeof SERVER_REGION_LABELS => (
                Object.hasOwn(SERVER_REGION_LABELS, region)
            )),
    );
    return serverRegionOptions()
        .filter(({ value }) => regionsWithAvailableCapacity.has(value as keyof typeof SERVER_REGION_LABELS));
}

export function maintenanceSlotOptions() {
    return MAINTENANCE_SLOTS.map((value) => ({
        value,
        label: `${value.replace("-", "–")} ${MAINTENANCE_TIME_ZONE}`,
    }));
}

export function applyControlPlaneOperationDefaults(
    operation: string,
    input: Record<string, unknown>,
) {
    if (operation === "create-server" && input.releaseChannel === undefined) {
        input.releaseChannel = "stable";
    }
}

export function operationTargetMatchesHash(hash: string, operation: string) {
    const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
    try {
        return decodeURIComponent(fragment) === operation;
    } catch {
        return false;
    }
}

export function serverLifecycleOperationHref(serverId: string) {
    return `/admin/control-plane?view=operations&serverId=${encodeURIComponent(serverId)}#server-operation`;
}

export function adminActionOptionValue(
    kind: string | undefined,
    option: { value: string; updatedAt?: string },
) {
    return kind === "server" || kind === "job"
        ? JSON.stringify({ id: option.value, updatedAt: option.updatedAt })
        : option.value;
}

export function presentControlPlaneOperationResult(
    operation: string,
    result: unknown,
): ControlPlaneOperationResultPresentation {
    if (!isRecord(result)) return { message: "Operation completed.", links: [] };

    if (operation === "import-latest-stable" && result.channel === "stable" && result.validationState === "validated") {
        const version = boundedText(result.version, 64);
        const buildId = boundedText(result.buildId, 128);
        const digest = boundedText(result.containerDigest, 71);
        if (version && buildId && digest) return {
            message: `Stable ${version} imported and validated. Build: ${buildId}. Image: ${digest}. This does not directly update or restart servers; existing update policies may select this build.`,
            links: [],
        };
    }

    const server = isRecord(result.server) ? result.server : null;
    const job = isRecord(result.job) ? result.job : null;
    const serverId = validUuid(server?.serverId) ?? validUuid(job?.serverId);
    const jobId = validUuid(job?.jobId);
    const links: ControlPlaneOperationResultLink[] = [];

    if (serverId !== null) {
        links.push({
            href: `/admin/control-plane?view=server&serverId=${encodeURIComponent(serverId)}`,
            label: "View server status",
        });
    }
    if (jobId !== null) {
        links.push({
            href: serverId === null
                ? "/admin/control-plane?view=jobs"
                : `/admin/control-plane?view=jobs&serverId=${encodeURIComponent(serverId)}`,
            label: "Track job progress",
        });
    }

    const generatedPassword = typeof result.generatedPassword === "string"
        ? result.generatedPassword
        : null;
    if (operation === "create-server" && serverId !== null) {
        const displayName = boundedText(server?.displayName, 100) ?? "Managed server";
        const state = boundedText(server?.operationState, 64) ?? "stopped";
        links.push({
            href: "/admin/control-plane?view=operations#server-operation",
            label: "Open lifecycle controls",
        });
        return {
            message: `${displayName} was created in ${state} state. Create reserves a prepared slot; it does not start Bannerlord. Use Lifecycle operation → Start when you are ready.${generatedPassword === null ? "" : `\nGenerated password: ${generatedPassword} (copy it now; it is not shown again).`}`,
            links,
        };
    }
    if (generatedPassword !== null) {
        return {
            message: `Operation completed. Generated password: ${generatedPassword} (copy it now; it is not shown again).`,
            links,
        };
    }
    if (jobId !== null) {
        const action = boundedText(job?.action, 64) ?? "Control-plane";
        const state = boundedText(job?.state, 64) ?? "accepted";
        const stage = boundedText(job?.progressStage, 128);
        return {
            message: `${action} job ${jobId} is ${state}${stage === null ? "." : ` at ${stage}.`} Progress refreshes automatically on its server and Jobs pages.`,
            links,
        };
    }
    const onboarding = isRecord(result.onboarding) ? result.onboarding : null;
    const onboardingState = boundedText(onboarding?.state, 64);
    const onboardingStage = boundedText(onboarding?.progressStage, 128);
    if (onboardingState !== null && onboardingStage !== null) {
        return {
            message: `VPS onboarding ${onboardingState}: ${onboardingStage}. Progress updates automatically on the VPS page.`,
            links,
        };
    }
    if (typeof result.reviewId === "string" || Object.hasOwn(result, "snapshot")) {
        return { message: JSON.stringify(result, null, 2).slice(0, 12_000), links };
    }
    return { message: "Operation completed and the dashboard has been refreshed.", links };
}

export function overviewStatRowClass(count: number) {
    if (count === 1) return "grid-cols-1";
    if (count === 2) return "grid-cols-1 sm:grid-cols-2";
    if (count === 3) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
    if (count === 4) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";
    throw new Error("Overview statistic rows must contain one through four cards.");
}

export function operationCardRows<T extends {
    fields: readonly unknown[];
    layoutPriority?: number;
}>(cards: readonly T[], pinnedLeadCount = 0): T[][] {
    if (!Number.isSafeInteger(pinnedLeadCount) || pinnedLeadCount < 0 || pinnedLeadCount > cards.length) {
        throw new Error("Pinned operation-card count is invalid.");
    }
    const pinned = cards.slice(0, pinnedLeadCount);
    const ranked = cards.slice(pinnedLeadCount)
        .map((card, index) => ({ card, index }))
        .sort((left, right) => (
            (right.card.layoutPriority ?? 0) - (left.card.layoutPriority ?? 0)
            || right.card.fields.length - left.card.fields.length
            || left.index - right.index
        ))
        .map(({ card }) => card);
    const inputCards = ranked.filter((card) => card.fields.length >= 2);
    const compactCards = ranked.filter((card) => card.fields.length < 2);

    return [
        ...(pinned.length === 0 ? [] : [pinned]),
        ...balancedRows(inputCards, 3),
        ...balancedRows(compactCards, 3),
    ];
}

export function operationCardRowClass(count: number) {
    if (count === 1) return "grid-cols-1";
    if (count === 2) return "grid-cols-1 md:grid-cols-2";
    if (count === 3) return "grid-cols-1 md:grid-cols-2 xl:grid-cols-3";
    throw new Error("Operation card rows must contain one through three cards.");
}

function balancedRows<T>(items: readonly T[], maximumColumns: number): T[][] {
    if (items.length === 0) return [];
    const rowCount = Math.ceil(items.length / maximumColumns);
    const minimumRowSize = Math.floor(items.length / rowCount);
    const largerRows = items.length % rowCount;
    const rows: T[][] = [];
    let offset = 0;
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        const size = minimumRowSize + (rowIndex < largerRows ? 1 : 0);
        rows.push(items.slice(offset, offset + size));
        offset += size;
    }
    return rows;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validUuid(value: unknown) {
    return typeof value === "string"
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
        ? value
        : null;
}

function boundedText(value: unknown, maximumLength: number) {
    return typeof value === "string" && value.length > 0 && value.length <= maximumLength
        ? value
        : null;
}
