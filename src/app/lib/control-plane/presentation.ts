import type { ReleaseBuild } from "@/app/lib/control-plane/types";

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

export function fieldRequirementLabel(required: boolean) {
    return required ? "Required" : "Optional";
}

export function operationTargetMatchesHash(hash: string, operation: string) {
    const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
    try {
        return decodeURIComponent(fragment) === operation;
    } catch {
        return false;
    }
}

export function presentControlPlaneOperationResult(
    operation: string,
    result: unknown,
): ControlPlaneOperationResultPresentation {
    if (!isRecord(result)) return { message: "Operation completed.", links: [] };

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

export function operationCardRows<T extends { fields: readonly unknown[] }>(cards: readonly T[], pinnedLeadCount = 0): T[][] {
    if (!Number.isSafeInteger(pinnedLeadCount) || pinnedLeadCount < 0 || pinnedLeadCount > cards.length) {
        throw new Error("Pinned operation-card count is invalid.");
    }
    const pinned = cards.slice(0, pinnedLeadCount);
    const ranked = cards.slice(pinnedLeadCount)
        .map((card, index) => ({ card, index }))
        .sort((left, right) => right.card.fields.length - left.card.fields.length || left.index - right.index)
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
