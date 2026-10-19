import { ControlPlaneAdminError } from "./client";
import { RELOCATION_JOB_ACTION } from "./relocation";
import type {
    HostingAdminPlacementPlan,
    HostingPlacementAlwaysOnPolicy,
    HostingPlacementAlwaysOnTargets,
    HostingPlacementExecutorSettings,
    HostingPlacementHost,
    HostingPlacementMove,
    HostingPlacementPinReason,
    HostingPlacementRelocation,
    HostingPlacementServer,
    HostingPlacementWeekday,
    HostingPlacementWindow,
} from "./types";

/** The control plane's defaults for an omitted `placement-plan` option. */
export const PLACEMENT_PLAN_DEFAULTS = {
    historyDays: 28,
    halfLifeDays: 14,
    maximumMoves: 16,
    minimumGainHours: 1,
    alwaysOnTargets: "any",
} as const satisfies HostingAdminPlacementPlan["options"];

/** Accepted ranges; the control plane validates them again. */
export const PLACEMENT_PLAN_LIMITS = {
    historyDays: { minimum: 14, maximum: 90, integer: true, label: "History days" },
    halfLifeDays: { minimum: 1, maximum: 90, integer: true, label: "Half-life days" },
    maximumMoves: { minimum: 0, maximum: 64, integer: true, label: "Maximum moves" },
    minimumGainHours: { minimum: 0, maximum: 168, integer: false, label: "Minimum gain" },
} as const;

export const PLACEMENT_ALWAYS_ON_TARGETS: ReadonlyArray<{ value: HostingPlacementAlwaysOnTargets; label: string }> = [
    { value: "any", label: "Anywhere, like other servers" },
    { value: "single-slot", label: "Only to one-slot VPSs (never shared)" },
    { value: "none", label: "Nowhere (pin them)" },
];

export type PlacementPlanForm = Record<keyof typeof PLACEMENT_PLAN_LIMITS | "alwaysOnTargets", string>;

export const PLACEMENT_WEEKDAYS: readonly HostingPlacementWeekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const WEEKDAY_LABELS: Record<HostingPlacementWeekday, string> = {
    monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};

const PIN_REASONS: Record<HostingPlacementPinReason, string> = {
    "unavailable-state": "Suspended, provisioning, configuring or being deleted",
    "no-provider-resource": "Missing its provider resource or location",
    "no-installed-build": "Never started, so there is nothing to back up",
    "insufficient-history": "Fewer than seven days of history",
    "always-on": "Always online; always-on servers are pinned",
    "no-compatible-host": "No accepting VPS it may move to serves its region",
};

/** Builds the `placement-plan` input from the form, or explains the first invalid field. */
export function placementPlanInput(form: PlacementPlanForm): { input: Record<string, number | string> } | { error: string } {
    const input: Record<string, number | string> = {};
    for (const [name, limit] of Object.entries(PLACEMENT_PLAN_LIMITS) as Array<[keyof typeof PLACEMENT_PLAN_LIMITS, typeof PLACEMENT_PLAN_LIMITS[keyof typeof PLACEMENT_PLAN_LIMITS]]>) {
        const text = form[name].trim();
        const value = Number(text);
        if (text === "" || !Number.isFinite(value) || (limit.integer && !Number.isInteger(value)) || value < limit.minimum || value > limit.maximum) {
            return { error: `${limit.label} must be ${limit.integer ? "a whole number" : "a number"} from ${limit.minimum} to ${limit.maximum}.` };
        }
        input[name] = value;
    }
    const alwaysOn = PLACEMENT_ALWAYS_ON_TARGETS.find((option) => option.value === form.alwaysOnTargets);
    if (alwaysOn === undefined) return { error: "Choose where always-on servers may move." };
    // The default is left out, so control planes that predate the option still accept the request.
    if (alwaysOn.value !== PLACEMENT_PLAN_DEFAULTS.alwaysOnTargets) input.alwaysOnTargets = alwaysOn.value;
    return { input };
}

/** Turns a failed dry run into text that says when it can be retried. */
export function placementPlanErrorMessage(error: unknown) {
    if (error instanceof ControlPlaneAdminError) {
        if (error.code === "rate_limited") return "You can run six dry runs every five minutes. Wait a few minutes, then run it again.";
        if (error.code === "placement_plan_busy") return "Another dry run with different options is still running. Try again in a few seconds.";
        return error.message;
    }
    return error instanceof Error ? error.message : "The dry run failed.";
}

/** A shallow shape check before the plan is rendered; field contents are rendered defensively. */
export function isPlacementPlan(value: unknown): value is HostingAdminPlacementPlan {
    if (typeof value !== "object" || value === null) return false;
    const plan = value as Record<string, unknown>;
    return plan.dryRun === true && typeof plan.generatedAt === "string"
        && typeof plan.options === "object" && plan.options !== null && typeof plan.model === "object" && plan.model !== null
        && typeof plan.current === "object" && plan.current !== null && typeof plan.proposed === "object" && plan.proposed !== null
        && Array.isArray(plan.servers) && Array.isArray(plan.hosts) && Array.isArray(plan.moves) && Array.isArray(plan.unsequencedServerIds);
}

export function weekdayLabel(weekday: HostingPlacementWeekday) {
    return WEEKDAY_LABELS[weekday] ?? weekday;
}

/** "Monday 02:00–04:00 UTC"; the end wraps past midnight. */
export function formatPlacementWindow(window: Pick<HostingPlacementWindow, "weekday" | "startsAtUtc" | "durationMinutes">) {
    const match = /^(\d{2}):(\d{2})$/u.exec(window.startsAtUtc);
    if (match === null || !Number.isFinite(window.durationMinutes)) return `${weekdayLabel(window.weekday)} ${window.startsAtUtc} UTC`;
    const end = (Number(match[1]) * 60 + Number(match[2]) + window.durationMinutes) % 1_440;
    return `${weekdayLabel(window.weekday)} ${window.startsAtUtc}–${twoDigits(Math.floor(end / 60))}:${twoDigits(end % 60)} UTC`;
}

export function pinnedReasonLabel(reason: HostingPlacementPinReason | null) {
    if (reason === null) return null;
    return PIN_REASONS[reason] ?? reason;
}

export function alwaysOnTargetsLabel(value: HostingPlacementAlwaysOnTargets | undefined) {
    return PLACEMENT_ALWAYS_ON_TARGETS.find((option) => option.value === (value ?? "any"))?.label ?? value ?? "any";
}

/** Hours per week with one decimal. */
export function formatPlacementHours(value: number) {
    return Number.isFinite(value) ? value.toFixed(1) : "—";
}

/** A signed change with one decimal, taken from the shown values so the columns add up; a saving reads negative. */
export function formatPlacementChange(current: number, proposed: number) {
    if (!Number.isFinite(current) || !Number.isFinite(proposed)) return "—";
    return signed(Number(proposed.toFixed(1)) - Number(current.toFixed(1)));
}

/** A step's own saving: positive saves pair-hours, zero or negative is an enabling leg of a swap. */
export function formatPlacementGain(value: number) {
    return Number.isFinite(value) ? signed(Number(value.toFixed(1))) : "—";
}

function signed(value: number) {
    if (Math.abs(value) < 0.05) return "0.0";
    return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}

export function formatProbability(value: number) {
    return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
}

/** Parses the 168-digit heatmap into seven weekday rows of 24 hourly digits, or null when malformed. */
export function parsePlacementHeatmap(heatmap: string): number[][] | null {
    if (typeof heatmap !== "string" || !/^[0-9]{168}$/u.test(heatmap)) return null;
    return PLACEMENT_WEEKDAYS.map((_, day) => [...heatmap.slice(day * 24, day * 24 + 24)].map(Number));
}

/** The online-probability band one heatmap digit stands for. */
export function heatmapBandLabel(digit: number) {
    return digit >= 9 ? "90–100%" : `${digit * 10}–${digit * 10 + 10}%`;
}

export function heatmapCellLabel(day: number, hour: number, digit: number) {
    return `${weekdayLabel(PLACEMENT_WEEKDAYS[day]!)} ${twoDigits(hour)}:00 UTC: ${heatmapBandLabel(digit)} online`;
}

/** One sentence describing a server's week for assistive technology. */
export function heatmapSummary(rows: readonly (readonly number[])[], weeklyOnlineHours: number) {
    let peak = { day: 0, hour: 0, digit: -1 };
    let quiet = { day: 0, hour: 0, digit: 10 };
    rows.forEach((row, day) => row.forEach((digit, hour) => {
        if (digit > peak.digit) peak = { day, hour, digit };
        if (digit < quiet.digit) quiet = { day, hour, digit };
    }));
    return `Online probability by hour, Monday to Sunday UTC; about ${formatPlacementHours(weeklyOnlineHours)} hours a week online. `
        + `Busiest ${heatmapCellLabel(peak.day, peak.hour, peak.digit)}; quietest ${heatmapCellLabel(quiet.day, quiet.hour, quiet.digit)}.`;
}

export function sortPlacementMoves(moves: readonly HostingPlacementMove[]) {
    return [...moves].sort((left, right) => left.step - right.step);
}

/** Servers the plan moves first, then by name. */
export function sortPlacementServers(servers: readonly HostingPlacementServer[]) {
    return [...servers].sort((left, right) => Number(left.serviceName === left.proposedServiceName) - Number(right.serviceName === right.proposedServiceName)
        || left.displayName.localeCompare(right.displayName) || left.serverId.localeCompare(right.serverId));
}

/** The most contended VPSs first, then by name. */
export function sortPlacementHosts(hosts: readonly HostingPlacementHost[]) {
    return [...hosts].sort((left, right) => right.current.pairHoursPerWeek - left.current.pairHoursPerWeek || left.serviceName.localeCompare(right.serviceName));
}

/** Server display names by ID; unknown IDs fall back to the ID. */
export function placementServerNames(plan: Pick<HostingAdminPlacementPlan, "servers" | "moves">) {
    const names = new Map<string, string>();
    for (const move of plan.moves) names.set(move.serverId, move.displayName);
    for (const server of plan.servers) names.set(server.serverId, server.displayName);
    return names;
}

export type PlacementMoveStatus =
    | { kind: "done" }
    | { kind: "relocating" }
    | { kind: "ready" }
    | { kind: "blocked"; reason: string };

/**
 * Where each step stands against the current inventory and active jobs. A server that takes
 * a staging hop appears in several steps, so a step is done once the server reached that
 * step's VPS or a later one of its own. Only the first unfinished step may run: a later step
 * can need the slot it frees. `queuedSteps` covers relocations this page queued before its
 * refreshed job list arrives.
 */
export function placementMoveStatuses(
    moves: readonly HostingPlacementMove[],
    servers: readonly Pick<HostingPlacementServer, "serverId" | "serviceName">[],
    currentHosts: ReadonlyMap<string, string>,
    activeJobs: ReadonlyMap<string, { action: string }>,
    queuedSteps: ReadonlySet<number>,
): Map<number, PlacementMoveStatus> {
    const ordered = sortPlacementMoves(moves);
    const planned = new Map(servers.map((server) => [server.serverId, server.serviceName]));
    const paths = new Map<string, string[]>();
    for (const move of ordered) {
        const path = paths.get(move.serverId) ?? [planned.get(move.serverId) ?? move.fromServiceName];
        path.push(move.toServiceName);
        paths.set(move.serverId, path);
    }
    const legs = new Map<string, number>();
    const statuses = new Map<number, PlacementMoveStatus>();
    let firstUnfinished: number | null = null;
    for (const move of ordered) {
        const leg = (legs.get(move.serverId) ?? 0) + 1;
        legs.set(move.serverId, leg);
        const current = currentHosts.get(move.serverId) ?? null;
        // How many of this server's steps its current VPS accounts for; -1 when it is off the plan's path.
        const reached = current === null ? -1 : paths.get(move.serverId)!.lastIndexOf(current);
        const job = activeJobs.get(move.serverId);
        const relocating = job?.action === RELOCATION_JOB_ACTION;
        let status: PlacementMoveStatus;
        if (reached >= leg) status = { kind: "done" };
        else if (queuedSteps.has(move.step) || (relocating && reached === leg - 1)) status = { kind: "relocating" };
        else if (reached >= 0 && reached < leg - 1) status = { kind: "blocked", reason: "Waiting for this server's earlier step." };
        else if (relocating) status = { kind: "blocked", reason: "This server is already relocating. Run a new dry run once it finishes." };
        else if (job !== undefined) status = { kind: "blocked", reason: `Waiting for the ${job.action} job to finish.` };
        else if (current === null) status = { kind: "blocked", reason: "This server does not occupy a VPS slot now. Run a new dry run." };
        else if (current !== move.fromServiceName) status = { kind: "blocked", reason: `This server is on ${current}, not ${move.fromServiceName}. Run a new dry run.` };
        else if (firstUnfinished !== null) status = { kind: "blocked", reason: `Run step ${firstUnfinished} first; this step can need the slot it frees.` };
        else status = { kind: "ready" };
        if (status.kind !== "done" && firstUnfinished === null) firstUnfinished = move.step;
        statuses.set(move.step, status);
    }
    return statuses;
}

/** Accepted executor ranges; the control plane validates them again. Moves are not rate limited. */
export const PLACEMENT_EXECUTOR_LIMITS = {
    minimumGainHours: { minimum: 1, maximum: 168, label: "Minimum gain" },
    noticeLeadHours: { minimum: 1, maximum: 168, label: "Notice lead time" },
} as const;

export const PLACEMENT_ALWAYS_ON_POLICIES: ReadonlyArray<{ value: HostingPlacementAlwaysOnPolicy; label: string }> = [
    { value: "single-slot", label: "Only to one-slot VPSs (never shared)" },
    { value: "none", label: "Never move them" },
    { value: "any", label: "Anywhere, like other servers" },
];

export type PlacementExecutorForm = Record<keyof typeof PLACEMENT_EXECUTOR_LIMITS | "alwaysOnPolicy" | "reason", string> & { enabled: boolean };

const MAXIMUM_ADMIN_REASON_LENGTH = 1_000;

/** The form for the saved settings; a retired `maximumRelocationsPerDay` from an older control plane is ignored. */
export function placementExecutorForm(settings: HostingPlacementExecutorSettings): PlacementExecutorForm {
    return {
        enabled: settings.enabled,
        minimumGainHours: String(settings.minimumGainHours),
        noticeLeadHours: String(settings.noticeLeadHours),
        alwaysOnPolicy: settings.alwaysOnPolicy,
        reason: "",
    };
}

/**
 * Builds the `set-placement-executor` input, guarded by the `updatedAt` last read (null when never saved).
 * The retired `maximumRelocationsPerDay` goes back exactly as last read when the read had one, so a control
 * plane that still requires it accepts the save; a newer one ignores it. It is left out when the read had none.
 */
export function placementExecutorInput(form: PlacementExecutorForm, expectedUpdatedAt: string | null, retiredMaximumRelocationsPerDay?: unknown): { input: Record<string, boolean | number | string | null> } | { error: string } {
    const input: Record<string, boolean | number | string | null> = { enabled: form.enabled };
    if (typeof retiredMaximumRelocationsPerDay === "number") input.maximumRelocationsPerDay = retiredMaximumRelocationsPerDay;
    for (const [name, limit] of Object.entries(PLACEMENT_EXECUTOR_LIMITS) as Array<[keyof typeof PLACEMENT_EXECUTOR_LIMITS, typeof PLACEMENT_EXECUTOR_LIMITS[keyof typeof PLACEMENT_EXECUTOR_LIMITS]]>) {
        const text = form[name].trim();
        const value = Number(text);
        if (text === "" || !Number.isInteger(value) || value < limit.minimum || value > limit.maximum) {
            return { error: `${limit.label} must be a whole number from ${limit.minimum} to ${limit.maximum}.` };
        }
        input[name] = value;
    }
    const policy = PLACEMENT_ALWAYS_ON_POLICIES.find((option) => option.value === form.alwaysOnPolicy);
    if (policy === undefined) return { error: "Choose where always-on servers may move." };
    input.alwaysOnPolicy = policy.value;
    input.expectedUpdatedAt = expectedUpdatedAt;
    const reason = form.reason.trim();
    if (reason.length > MAXIMUM_ADMIN_REASON_LENGTH || /[\p{Cc}\p{Cf}]/u.test(reason)) return { error: `The reason must be one line of at most ${MAXIMUM_ADMIN_REASON_LENGTH} characters.` };
    if (reason !== "") input.reason = reason;
    return { input };
}

/** What turning the executor on does, for the confirmation an administrator must accept. */
export function placementExecutorEnableConfirmation(input: { minimumGainHours: number; noticeLeadHours: number; alwaysOnPolicy: HostingPlacementAlwaysOnPolicy }) {
    const lead = input.noticeLeadHours === 1 ? "an hour" : `${input.noticeLeadHours} hours`;
    // With always-on servers excluded, the running servers that move are only the others.
    const runningServer = input.alwaysOnPolicy === "none" ? "A running server that is not always-on" : "A running server";
    const alwaysOn = input.alwaysOnPolicy === "none"
        ? " Always-on servers are never moved."
        : input.alwaysOnPolicy === "single-slot" ? " Always-on servers move only to one-slot VPSs, which they never share." : "";
    return "Turn on automatic placement?\n\n"
        + `The control plane will relocate customer servers to other VPSs by itself, one at a time, whenever a move saves at least ${input.minimumGainHours} pair-hours a week. `
        + "Each move stops the game for a few minutes and changes the server's IP address and game port, so players need the new address to join. "
        + `Stopped servers move at once. ${runningServer} is moved ${lead} after a notice on its page, with in-game warnings an hour and ten minutes ahead; the move stops the game and starts it again on the new VPS.${alwaysOn}`;
}

/** Turns a failed executor read or save into text for the administrator. */
export function placementExecutorErrorMessage(error: unknown) {
    if (error instanceof ControlPlaneAdminError && error.code === "stale_interaction") {
        return "Someone else changed these settings. The current settings are shown; review them and save again.";
    }
    if (error instanceof ControlPlaneAdminError && error.code === "relocation_provider_unsupported") {
        return "Automatic placement can only be turned on when the control plane runs in live OVH mode.";
    }
    return error instanceof Error ? error.message : "The executor settings could not be saved.";
}

export function alwaysOnPolicyLabel(value: HostingPlacementAlwaysOnPolicy) {
    return PLACEMENT_ALWAYS_ON_POLICIES.find((option) => option.value === value)?.label ?? value;
}

const RELOCATION_STATE_LABELS: Record<HostingPlacementRelocation["state"], string> = {
    announced: "Announced",
    queued: "Queued",
    succeeded: "Moved",
    failed: "Failed",
    cancelled: "Cancelled",
};

export function placementRelocationStateLabel(state: HostingPlacementRelocation["state"]) {
    return RELOCATION_STATE_LABELS[state] ?? state;
}

function twoDigits(value: number) {
    return String(value).padStart(2, "0");
}
