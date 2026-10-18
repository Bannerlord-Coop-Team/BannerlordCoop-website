"use client";

import { ArrowLeftRight, LoaderCircle, Play, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Definition, Empty, Panel, SectionHeading } from "@/app/components/admin/ControlPlanePresentation";
import { LocalDateTime } from "@/app/components/admin/LocalDateTime";
import { PlacementExecutorPanel } from "@/app/components/admin/PlacementExecutorPanel";
import { RelocateDialog } from "@/app/components/admin/RelocateView";
import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import { operationExplanation } from "@/app/lib/control-plane/explanations";
import {
    alwaysOnTargetsLabel,
    formatPlacementChange,
    formatPlacementGain,
    formatPlacementHours,
    formatPlacementWindow,
    formatProbability,
    heatmapBandLabel,
    heatmapCellLabel,
    heatmapSummary,
    isPlacementPlan,
    parsePlacementHeatmap,
    pinnedReasonLabel,
    PLACEMENT_ALWAYS_ON_TARGETS,
    PLACEMENT_PLAN_DEFAULTS,
    PLACEMENT_PLAN_LIMITS,
    PLACEMENT_WEEKDAYS,
    placementMoveStatuses,
    placementPlanErrorMessage,
    placementPlanInput,
    placementServerNames,
    sortPlacementHosts,
    sortPlacementMoves,
    sortPlacementServers,
    weekdayLabel,
    type PlacementMoveStatus,
    type PlacementPlanForm,
} from "@/app/lib/control-plane/placement";
import {
    activeJobsByServer,
    occupiedSlotsByServer,
    relocationRows,
    relocationTargets,
    type RelocationRow,
} from "@/app/lib/control-plane/relocation";
import type {
    HostingAdminPlacementPlan,
    HostingPlacementContention,
    HostingPlacementHost,
    HostingPlacementMove,
    HostingPlacementServer,
    PlacementViewData,
    ServerDashboardResult,
} from "@/app/lib/control-plane/types";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import { hostingRegionLabel } from "../../../../supabase/functions/_shared/hosting-regions";

const buttonClass = "inline-flex min-h-9 items-center gap-1.5 border px-3 font-label text-[0.62rem] font-semibold uppercase tracking-[0.12em] disabled:cursor-not-allowed disabled:opacity-40";
const inputClass = "mt-1.5 min-h-10 w-full border border-white/15 bg-background px-3 text-xs text-foreground outline-none placeholder:text-foreground-dim focus:border-gold";
const labelClass = "font-label text-[0.6rem] font-semibold uppercase tracking-[0.13em] text-foreground-muted";
const tableHeadClass = "border-b border-white/10 font-label text-[0.62rem] uppercase tracking-[0.12em] text-foreground-muted";
const badgeClass = "inline-flex w-fit border px-2 py-0.5 font-label text-[0.58rem] font-semibold uppercase tracking-[0.1em]";
// One gold ramp from the surface to full gold: a darker cell is less likely to be online.
const HEATMAP_CLASSES = ["bg-gold/10", "bg-gold/20", "bg-gold/30", "bg-gold/40", "bg-gold/50", "bg-gold/60", "bg-gold/70", "bg-gold/80", "bg-gold/90", "bg-gold"];
const DEFAULT_FORM: PlacementPlanForm = {
    historyDays: String(PLACEMENT_PLAN_DEFAULTS.historyDays),
    halfLifeDays: String(PLACEMENT_PLAN_DEFAULTS.halfLifeDays),
    maximumMoves: String(PLACEMENT_PLAN_DEFAULTS.maximumMoves),
    minimumGainHours: String(PLACEMENT_PLAN_DEFAULTS.minimumGainHours),
    alwaysOnTargets: PLACEMENT_PLAN_DEFAULTS.alwaysOnTargets,
};
const FORM_HELP: Record<keyof typeof PLACEMENT_PLAN_LIMITS, string> = {
    historyDays: "Days of reconcile history to learn from.",
    halfLifeDays: "Age at which an observation counts half as much as one from now.",
    maximumMoves: "Most servers the plan may relocate; 0 analyzes only.",
    minimumGainHours: "Pair-hours per week each relocation step must be worth, staging hops included.",
};

/**
 * The co-tenancy placement planner. The dry run is slow and rate limited per administrator,
 * so it runs only when asked; its moves are executed one step at a time through relocation.
 */
export function PlacementView({ data }: { data: PlacementViewData }) {
    const [form, setForm] = useState<PlacementPlanForm>(DEFAULT_FORM);
    const [plan, setPlan] = useState<HostingAdminPlacementPlan | null>(null);
    const [startedAt, setStartedAt] = useState<number | null>(null);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [error, setError] = useState("");
    const controller = useRef<AbortController | null>(null);

    useEffect(() => () => controller.current?.abort(), []);
    useEffect(() => {
        if (startedAt === null) return;
        const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000)), 1_000);
        return () => window.clearInterval(timer);
    }, [startedAt]);

    async function run(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (startedAt !== null) return;
        const parsed = placementPlanInput(form);
        if ("error" in parsed) {
            setError(parsed.error);
            return;
        }
        const request = new AbortController();
        controller.current = request;
        setError("");
        setElapsedSeconds(0);
        setStartedAt(Date.now());
        try {
            const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
            if (!session?.access_token) throw new Error("Authentication is required.");
            const result = await requestControlPlaneAdmin<unknown>({
                accessToken: session.access_token,
                requestId: crypto.randomUUID(),
                operation: "placement-plan",
                input: parsed.input,
                signal: request.signal,
            });
            if (request.signal.aborted) return;
            if (!isPlacementPlan(result)) throw new Error("The control plane returned an unexpected placement plan.");
            setPlan(result);
        } catch (cause) {
            if (!request.signal.aborted) setError(placementPlanErrorMessage(cause));
        } finally {
            if (!request.signal.aborted) setStartedAt(null);
        }
    }

    const running = startedAt !== null;
    return (
        <section className="mt-8 space-y-8">
            <PlacementExecutorPanel />
            <form onSubmit={(event) => void run(event)} className="border border-white/10 bg-surface p-5" aria-labelledby="placement-plan-heading">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div className="max-w-3xl">
                        <p className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-gold">Co-tenancy planner</p>
                        <h2 id="placement-plan-heading" className="mt-1 font-display text-3xl font-semibold text-foreground">Placement dry run</h2>
                        <p className="mt-2 text-xs leading-5 text-foreground-muted">{operationExplanation("placement-plan")}</p>
                    </div>
                </div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    {(Object.keys(PLACEMENT_PLAN_LIMITS) as Array<keyof typeof PLACEMENT_PLAN_LIMITS>).map((name) => {
                        const limit = PLACEMENT_PLAN_LIMITS[name];
                        return (
                            <label key={name} className="block">
                                <span className={labelClass} title={FORM_HELP[name]}>{limit.label}{name === "minimumGainHours" ? " (pair-h/week)" : ""}</span>
                                <input
                                    name={name}
                                    type="number"
                                    inputMode={limit.integer ? "numeric" : "decimal"}
                                    min={limit.minimum}
                                    max={limit.maximum}
                                    step={limit.integer ? 1 : "any"}
                                    required
                                    value={form[name]}
                                    disabled={running}
                                    onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))}
                                    className={inputClass}
                                />
                                <span className="mt-1 block text-[0.65rem] leading-4 text-foreground-dim">{limit.minimum}–{limit.maximum}. {FORM_HELP[name]}</span>
                            </label>
                        );
                    })}
                    <label className="block">
                        <span className={labelClass}>Always-on servers</span>
                        <select
                            name="alwaysOnTargets"
                            value={form.alwaysOnTargets}
                            disabled={running}
                            onChange={(event) => setForm((current) => ({ ...current, alwaysOnTargets: event.target.value }))}
                            className={inputClass}
                        >
                            {PLACEMENT_ALWAYS_ON_TARGETS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                        <span className="mt-1 block text-[0.65rem] leading-4 text-foreground-dim">Where a server that is online even in its quietest window may move.</span>
                    </label>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-4">
                    <button type="submit" disabled={running} className={`${buttonClass} min-h-10 border-crimson bg-crimson px-5 text-white hover:bg-crimson-hover`}>
                        {running ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Play aria-hidden="true" className="size-3.5" />}
                        {running ? "Running" : "Run dry run"}
                    </button>
                    <button type="button" disabled={running} onClick={() => { setForm(DEFAULT_FORM); setError(""); }} className={`${buttonClass} border-white/15 text-foreground-muted hover:text-foreground`}>Defaults</button>
                    <p className="text-xs text-foreground-dim">A dry run takes about 3–10 seconds. Each administrator can run six every five minutes.</p>
                </div>
                {running && <p role="status" className="mt-4 text-xs text-gold">Planning from reconcile history… {elapsedSeconds} s</p>}
                {error && <p role="alert" className="mt-4 border-l-2 border-crimson bg-crimson/10 px-3 py-2 text-xs text-red-200">{error}</p>}
            </form>
            {plan === null
                ? !running && <div className="border border-white/10 bg-surface"><Empty>Run a dry run to see the proposed placement. Nothing is relocated until you run a step.</Empty></div>
                : <PlacementPlanResult plan={plan} data={data} />}
        </section>
    );
}

function PlacementPlanResult({ plan, data }: { plan: HostingAdminPlacementPlan; data: PlacementViewData }) {
    const names = useMemo(() => placementServerNames(plan), [plan]);
    const staging = plan.moves.filter((move) => move.staging).length;
    const unsequenced = plan.unsequencedServerIds.map((serverId) => names.get(serverId) ?? serverId);
    return (
        <div className="space-y-8">
            <div className="grid gap-6 lg:grid-cols-2">
                <PlacementTotals current={plan.current} proposed={plan.proposed} />
                <Panel title="Plan" help="The resolved options and the history the model learned from.">
                    <Definition label="Generated" value={<LocalDateTime value={plan.generatedAt} />} />
                    <Definition label="Servers changing VPS" value={String(plan.relocations)} />
                    <Definition label="Steps" value={staging === 0 ? String(plan.moves.length) : `${plan.moves.length} (${staging} staging)`} />
                    <Definition label="Unsequenced" value={unsequenced.length === 0 ? "None" : unsequenced.join(", ")} tone={unsequenced.length === 0 ? undefined : "warning"}
                        help="Servers the search would move but no sequence of free slots reaches; they stay where they are." />
                    <Definition label="History from" value={<LocalDateTime value={plan.model.historyStartedAt} />} />
                    <Definition label="Samples" value={plan.model.samples.toLocaleString("en-US")} help={`${plan.model.binMinutes}-minute bins in ${plan.model.timeZone}; a server needs ${plan.model.minimumObservedDays} observed days to move.`} />
                    <Definition label="Search evaluations" value={plan.model.searchEvaluations.toLocaleString("en-US")} />
                    <Definition label="Options" value={`${plan.options.historyDays} d history · ${plan.options.halfLifeDays} d half-life · ${plan.options.maximumMoves} moves · ${plan.options.minimumGainHours} h gain · always-on: ${lowerFirst(alwaysOnTargetsLabel(plan.options.alwaysOnTargets))}`} />
                </Panel>
            </div>
            <PlacementMoves plan={plan} data={data} />
            <PlacementServers plan={plan} />
            <PlacementHosts plan={plan} names={names} />
        </div>
    );
}

function PlacementTotals({ current, proposed }: { current: HostingPlacementContention; proposed: HostingPlacementContention }) {
    const rows: Array<{ key: keyof HostingPlacementContention; label: string; help: string }> = [
        { key: "pairHoursPerWeek", label: "Co-online pair-hours", help: "Model: expected pair-hours per week that two servers on one VPS are online together. The planner minimizes this." },
        { key: "contendedHoursPerWeek", label: "Hours with 2+ online", help: "Model: expected hours per week in which at least two servers on one VPS are online." },
        { key: "saturatedHoursPerWeek", label: "Hours with 3+ online", help: "Model: expected hours per week in which at least three servers on one VPS are online." },
        { key: "observedPairHoursPerWeek", label: "Observed replay pair-hours", help: "The history window replayed onto the placement. In-sample evidence, not a forecast." },
    ];
    return (
        <section className="border border-white/10 bg-surface p-5">
            <h2 className="font-display text-2xl font-semibold text-foreground">Fleet totals</h2>
            <p className="mt-1 text-xs text-foreground-muted">Hours per week, summed over every VPS.</p>
            <table className="mt-4 w-full text-left text-xs">
                <thead className={tableHeadClass}><tr><th className="py-2 pr-3">Measure</th><th className="py-2 pr-3 text-right">Current</th><th className="py-2 pr-3 text-right">Proposed</th><th className="py-2 text-right">Change</th></tr></thead>
                <tbody className="divide-y divide-white/10">{rows.map(({ key, label, help }) => (
                    <tr key={key}>
                        <th scope="row" className="py-3 pr-3 font-normal text-foreground-muted"><span title={help} className="cursor-help underline decoration-dotted underline-offset-4">{label}</span></th>
                        <td className="py-3 pr-3 text-right font-mono text-foreground">{formatPlacementHours(current[key])}</td>
                        <td className="py-3 pr-3 text-right font-mono text-foreground">{formatPlacementHours(proposed[key])}</td>
                        <td className={`py-3 text-right font-mono ${proposed[key] < current[key] ? "text-emerald-300" : proposed[key] > current[key] ? "text-amber-300" : "text-foreground-muted"}`}>{formatPlacementChange(current[key], proposed[key])}</td>
                    </tr>
                ))}</tbody>
            </table>
        </section>
    );
}

function PlacementMoves({ plan, data }: { plan: HostingAdminPlacementPlan; data: PlacementViewData }) {
    const router = useRouter();
    const hosts = useMemo(() => Array.isArray(data.inventory.hosts) ? data.inventory.hosts : [], [data.inventory.hosts]);
    const moves = useMemo(() => sortPlacementMoves(plan.moves), [plan.moves]);
    // Steps this page queued from this plan; they read as relocating until refreshed inventory and jobs arrive.
    const [queued, setQueued] = useState<{ data: PlacementViewData; plan: HostingAdminPlacementPlan; steps: ReadonlySet<number> }>({ data, plan, steps: new Set() });
    const [opening, setOpening] = useState<number | null>(null);
    const [openError, setOpenError] = useState<{ step: number; message: string } | null>(null);
    const [dialog, setDialog] = useState<{ move: HostingPlacementMove; row: RelocationRow } | null>(null);
    const statuses = useMemo(() => {
        const currentHosts = new Map([...occupiedSlotsByServer(hosts)].map(([serverId, slot]) => [serverId, slot.hostName]));
        return placementMoveStatuses(moves, plan.servers, currentHosts, activeJobsByServer(data.activeJobs), queued.data === data && queued.plan === plan ? queued.steps : new Set());
    }, [moves, plan, hosts, data, queued]);

    // Reads the server's current generation so the relocation carries a fresh expectedUpdatedAt.
    async function open(move: HostingPlacementMove) {
        if (opening !== null) return;
        setOpening(move.step);
        setOpenError(null);
        try {
            const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
            if (!session?.access_token) throw new Error("Authentication is required.");
            const { dashboard } = await requestControlPlaneAdmin<ServerDashboardResult>({
                accessToken: session.access_token,
                requestId: crypto.randomUUID(),
                operation: "server-dashboard",
                input: { serverId: move.serverId },
            });
            if (dashboard?.server?.serverId !== move.serverId) throw new Error("The control plane returned a different server.");
            if (dashboard.activeJob) throw new Error(`Waiting for the ${dashboard.activeJob.action} job to finish.`);
            const [row] = relocationRows([dashboard.server], hosts, []);
            setDialog({ move, row: row! });
        } catch (cause) {
            setOpenError({ step: move.step, message: cause instanceof Error ? cause.message : "The server could not be read." });
        } finally {
            setOpening(null);
        }
    }

    return (
        <section aria-labelledby="placement-moves-heading">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <p className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-gold">Run in step order</p>
                    <h2 id="placement-moves-heading" className="mt-1 font-display text-3xl font-semibold text-foreground">Moves</h2>
                </div>
                <div className="flex items-center gap-3">
                    <span className="font-display text-xl text-foreground-muted">{moves.length}</span>
                    <button type="button" onClick={() => router.refresh()} className={`${buttonClass} border-white/15 text-foreground-muted hover:text-foreground`}>
                        <RefreshCw aria-hidden="true" className="size-3.5" /> Refresh status
                    </button>
                </div>
            </div>
            <p className="mt-3 max-w-4xl text-sm text-amber-200">
                Each step is a real relocation: a running game stops for a few minutes, and the server&apos;s address and game port change, so players need the new address to join. Run one step at a time and let it finish before the next; a later step can need the slot an earlier one frees. Staging steps are temporary hops into a spare slot.
            </p>
            <div className="mt-5 overflow-x-auto border border-white/10 bg-surface">
                <table className="w-full min-w-260 text-left text-sm">
                    <thead className={tableHeadClass}>
                        <tr><th className="p-4">Step</th><th className="p-4">Server</th><th className="p-4">VPS</th><th className="p-4">Region</th><th className="p-4 text-right" title="Co-online pair-hours per week this step saves on its own, in step order.">Gain</th><th className="p-4">Quiet window</th><th className="p-4">Status</th><th className="p-4"><span className="sr-only">Relocate</span></th></tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">{moves.map((move) => {
                        const status: PlacementMoveStatus = statuses.get(move.step) ?? { kind: "blocked", reason: "" };
                        return (
                            <tr key={move.step}>
                                <td className="p-4 font-mono text-xs text-foreground">{move.step}</td>
                                <td className="p-4">
                                    <p className="font-semibold text-gold">{move.displayName}</p>
                                    {move.staging && <span className={`${badgeClass} mt-1 border-sky-400/30 bg-sky-400/10 text-sky-300`} title="A temporary hop into a spare slot that unblocks a cycle of full VPSs.">Staging</span>}
                                </td>
                                <td className="p-4 font-mono text-xs text-foreground-muted">{move.fromServiceName} → <span className="text-foreground">{move.toServiceName}</span></td>
                                <td className="p-4 text-xs text-foreground">{hostingRegionLabel(move.targetRegion)}</td>
                                <td className={`p-4 text-right font-mono text-xs ${move.gainPairHoursPerWeek > 0 ? "text-emerald-300" : "text-foreground-muted"}`} title={move.gainPairHoursPerWeek > 0 ? undefined : "This step saves nothing on its own; it enables a later step, such as one leg of a swap."}>{formatPlacementGain(move.gainPairHoursPerWeek)}</td>
                                <td className="p-4 text-xs text-foreground-muted">
                                    <p className="text-foreground">{formatPlacementWindow(move.window)}</p>
                                    <p className="mt-1">Next <LocalDateTime value={move.window.nextStartsAt} /> · {formatProbability(move.window.onlineProbability)} online</p>
                                </td>
                                <td className="p-4 text-xs"><MoveStatus status={status} /></td>
                                <td className="p-4 text-right">
                                    <button
                                        type="button"
                                        disabled={status.kind !== "ready" || opening !== null}
                                        title={status.kind === "blocked" ? status.reason : undefined}
                                        onClick={() => void open(move)}
                                        className={`${buttonClass} border-gold/40 text-gold hover:bg-gold/10`}
                                    >
                                        {opening === move.step ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <ArrowLeftRight aria-hidden="true" className="size-3.5" />} Relocate
                                    </button>
                                    {openError?.step === move.step && <p role="alert" className="mt-2 text-xs text-red-200">{openError.message}</p>}
                                </td>
                            </tr>
                        );
                    })}</tbody>
                </table>
                {moves.length === 0 && <Empty>The plan proposes no moves: the current placement is already the best it found within these options.</Empty>}
            </div>
            {dialog !== null && (
                <RelocateDialog
                    key={dialog.move.step}
                    row={dialog.row}
                    targets={relocationTargets(hosts, data.regionCatalog, dialog.row.hostName)}
                    preselected={{ region: dialog.move.targetRegion, serviceName: dialog.move.toServiceName }}
                    reason={`Placement plan step ${dialog.move.step}`}
                    onClose={() => setDialog(null)}
                    onQueued={() => {
                        setQueued((current) => ({ data, plan, steps: new Set(current.data === data && current.plan === plan ? current.steps : []).add(dialog.move.step) }));
                        setDialog(null);
                    }}
                >
                    <p className="text-sm text-foreground-muted">
                        Step {dialog.move.step} of the dry run{dialog.move.staging ? ", a temporary staging hop" : ""}: {dialog.move.fromServiceName} → {dialog.move.toServiceName}. Its quiet window is {formatPlacementWindow(dialog.move.window)}, next <LocalDateTime value={dialog.move.window.nextStartsAt} />.
                    </p>
                    <p className="text-sm text-amber-200">A running game stops for the move, and players need the new address and game port to join.</p>
                </RelocateDialog>
            )}
        </section>
    );
}

function MoveStatus({ status }: { status: PlacementMoveStatus }) {
    if (status.kind === "done") return <span className={`${badgeClass} border-emerald-500/30 bg-emerald-500/10 text-emerald-300`}>Done</span>;
    if (status.kind === "relocating") return <span className={`${badgeClass} border-sky-400/30 bg-sky-400/10 text-sky-300`}>Relocating</span>;
    if (status.kind === "ready") return <span className={`${badgeClass} border-gold/40 bg-gold/10 text-gold`}>Next</span>;
    return <span className="text-foreground-muted">{status.reason}</span>;
}

function PlacementServers({ plan }: { plan: HostingAdminPlacementPlan }) {
    const servers = useMemo(() => sortPlacementServers(plan.servers), [plan.servers]);
    const unsequenced = useMemo(() => new Set(plan.unsequencedServerIds), [plan.unsequencedServerIds]);
    return (
        <section aria-label="Servers">
            <SectionHeading eyebrow="Learned weekly activity" title="Servers" count={servers.length} />
            <HeatmapLegend />
            <div className="mt-4 overflow-x-auto border border-white/10 bg-surface">
                <table className="w-full min-w-260 text-left text-sm">
                    <thead className={tableHeadClass}>
                        <tr><th className="p-4">Server</th><th className="p-4">VPS</th><th className="p-4">Pinned</th><th className="p-4 text-right">Online / week</th><th className="p-4 text-right">Observed</th><th className="p-4">Week (UTC)</th></tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">{servers.map((server) => {
                        const moves = server.proposedServiceName !== server.serviceName;
                        return (
                            <tr key={server.serverId}>
                                <td className="p-4 align-top">
                                    <p className="font-semibold text-gold">{server.displayName}</p>
                                    <p className="mt-1 text-xs text-foreground-muted">{hostingRegionLabel(server.region)}</p>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {server.alwaysOn === true && <span className={`${badgeClass} border-amber-400/30 bg-amber-400/10 text-amber-200`} title="Still online at least half the time in its quietest two-hour window, so moving it interrupts a game.">Always on</span>}
                                        {unsequenced.has(server.serverId) && <span className={`${badgeClass} border-white/15 text-foreground-muted`} title="The search would move it, but no sequence of free slots reaches its target.">Unsequenced</span>}
                                    </div>
                                </td>
                                <td className="p-4 align-top font-mono text-xs text-foreground-muted">{moves ? <>{server.serviceName} → <span className="text-foreground">{server.proposedServiceName}</span></> : server.serviceName}</td>
                                <td className="p-4 align-top text-xs text-foreground-muted">{pinnedReasonLabel(server.pinnedReason) ?? "—"}</td>
                                <td className="p-4 text-right align-top font-mono text-xs text-foreground">{formatPlacementHours(server.weeklyOnlineHours)} h</td>
                                <td className="p-4 text-right align-top font-mono text-xs text-foreground-muted">{server.observedDays} d</td>
                                <td className="p-4 align-top"><PlacementHeatmap server={server} /></td>
                            </tr>
                        );
                    })}</tbody>
                </table>
                {servers.length === 0 && <Empty>No placed servers.</Empty>}
            </div>
        </section>
    );
}

function HeatmapLegend() {
    return (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.65rem] text-foreground-muted" aria-hidden="true">
            <span>Each row is a UTC weekday from Monday, each square one hour. Online probability:</span>
            <span>{heatmapBandLabel(0)}</span>
            <span className="flex gap-px">{HEATMAP_CLASSES.map((className) => <span key={className} className={`size-2.5 ${className}`} />)}</span>
            <span>{heatmapBandLabel(9)}</span>
        </div>
    );
}

/** A 7×24 grid of the 168-digit hourly profile; the label carries the summary, each square its own hour. */
export function PlacementHeatmap({ server }: { server: Pick<HostingPlacementServer, "displayName" | "heatmap" | "weeklyOnlineHours"> }) {
    const rows = parsePlacementHeatmap(server.heatmap);
    if (rows === null) return <span className="text-xs text-foreground-dim">Unavailable</span>;
    return (
        <div role="img" aria-label={`${server.displayName}: ${heatmapSummary(rows, server.weeklyOnlineHours)}`} className="grid w-max gap-px" style={{ gridTemplateColumns: "0.75rem repeat(24, 0.5rem)" }}>
            {rows.map((row, day) => (
                <Fragment key={day}>
                    <span className="font-mono text-[0.5rem] leading-2 text-foreground-dim" title={weekdayLabel(PLACEMENT_WEEKDAYS[day]!)}>{weekdayLabel(PLACEMENT_WEEKDAYS[day]!).charAt(0)}</span>
                    {row.map((digit, hour) => <span key={hour} title={heatmapCellLabel(day, hour, digit)} className={`size-2 ${HEATMAP_CLASSES[digit]}`} />)}
                </Fragment>
            ))}
        </div>
    );
}

function PlacementHosts({ plan, names }: { plan: HostingAdminPlacementPlan; names: ReadonlyMap<string, string> }) {
    const hosts = useMemo(() => sortPlacementHosts(plan.hosts), [plan.hosts]);
    const label = (serverIds: readonly string[]) => serverIds.length === 0 ? "Empty" : serverIds.map((serverId) => names.get(serverId) ?? serverId).join(", ");
    return (
        <section aria-label="VPS hosts">
            <SectionHeading eyebrow="Most contended first" title="VPS hosts" count={hosts.length} />
            <div className="mt-4 overflow-x-auto border border-white/10 bg-surface">
                <table className="w-full min-w-260 text-left text-sm">
                    <thead className={tableHeadClass}>
                        <tr><th className="p-4">VPS</th><th className="p-4">Capacity</th><th className="p-4">Relocations</th><th className="p-4 text-right">Pair-hours</th><th className="p-4 text-right">2+ online</th><th className="p-4 text-right">3+ online</th><th className="p-4">Servers</th></tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">{hosts.map((host) => (
                        <tr key={host.serviceName}>
                            <td className="p-4 align-top"><p className="font-mono text-xs text-foreground">{host.serviceName}</p><p className="mt-1 text-xs text-foreground-muted">{host.regionKeys.length === 0 ? "No region" : host.regionKeys.map(hostingRegionLabel).join(", ")}</p></td>
                            <td className="p-4 align-top text-xs text-foreground-muted">{host.vCpu} vCPU · {host.slots} {host.slots === 1 ? "slot" : "slots"} · {host.freeSlots} free</td>
                            <td className="p-4 align-top text-xs">{host.acceptsRelocations ? <span className="text-emerald-300">Accepts</span> : <span className="text-foreground-muted" title="Not onboarded with the configured image, so relocation cannot target it. It keeps its servers.">Keeps its servers</span>}</td>
                            <HostMeasure host={host} measure="pairHoursPerWeek" />
                            <HostMeasure host={host} measure="contendedHoursPerWeek" />
                            <HostMeasure host={host} measure="saturatedHoursPerWeek" />
                            <td className="p-4 align-top text-xs text-foreground-muted">
                                <p>{label(host.current.serverIds)}</p>
                                {!sameMembers(host.current.serverIds, host.proposed.serverIds) && <p className="mt-1 text-foreground">→ {label(host.proposed.serverIds)}</p>}
                            </td>
                        </tr>
                    ))}</tbody>
                </table>
                {hosts.length === 0 && <Empty>No VPS hosts in the plan.</Empty>}
            </div>
        </section>
    );
}

function HostMeasure({ host, measure }: { host: HostingPlacementHost; measure: keyof HostingPlacementContention }) {
    const current = host.current[measure];
    const proposed = host.proposed[measure];
    return (
        <td className="p-4 text-right align-top font-mono text-xs text-foreground">
            {formatPlacementHours(current)}
            {proposed !== current && <span className={`block ${proposed < current ? "text-emerald-300" : "text-amber-300"}`}>→ {formatPlacementHours(proposed)}</span>}
        </td>
    );
}

// Labels start a sentence; mid-sentence only their first letter drops, keeping "VPSs" intact.
function lowerFirst(text: string) {
    return text.charAt(0).toLowerCase() + text.slice(1);
}

function sameMembers(left: readonly string[], right: readonly string[]) {
    return left.length === right.length && left.every((serverId) => right.includes(serverId));
}
