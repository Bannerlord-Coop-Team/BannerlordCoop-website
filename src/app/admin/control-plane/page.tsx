import {
    ControlPlaneActionCard,
    type AdminActionField,
    type AdminActionOption,
} from "@/app/components/admin/ControlPlaneActionCard";
import { hasAdminAccess } from "@/app/lib/auth/access";
import { ControlPlaneAdminError, requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import {
    destructiveExplanation,
    jobActionExplanation,
    operationExplanation,
    stateExplanation,
} from "@/app/lib/control-plane/explanations";
import { installableBuilds } from "@/app/lib/control-plane/presentation";
import type {
    AuditEvent,
    Backup,
    GlobalControls,
    HostingAdminVpsHost,
    HostingJob,
    HostingPage,
    ManagedServer,
    Overview,
    ReleaseBuild,
    ServerDashboardResult,
} from "@/app/lib/control-plane/types";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { listDiscordUsers } from "@/app/lib/supabase/users";
import type { DiscordUserSummary } from "@/app/lib/supabase/discord-users";
import {
    Activity,
    ArrowLeft,
    BriefcaseBusiness,
    Cloud,
    CloudCog,
    History,
    ListChecks,
    PackageCheck,
    ServerCog,
    ShieldCheck,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
    ControlPlaneViewSkeleton,
    type ControlPlaneView,
} from "@/app/admin/control-plane/skeleton";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Control Plane | Bannerlord Coop",
    description: "Operate the Bannerlord Coop managed-hosting control plane.",
};

type View = ControlPlaneView;
type PageProps = {
    searchParams: Promise<{
        view?: string | string[];
        q?: string | string[];
        serverId?: string | string[];
    }>;
};

export default async function ControlPlaneAdminPage({ searchParams }: PageProps) {
    const supabase = await getSupabaseServerClient();
    const [{ data: userData }, { data: sessionData }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.auth.getSession(),
    ]);
    if (!userData.user || !sessionData.session?.access_token) redirect("/login?next=/admin/control-plane");
    if (!hasAdminAccess(userData.user)) redirect("/");

    const params = await searchParams;
    const view = parseView(first(params.view));
    const query = (first(params.q) ?? "").trim().slice(0, 100);
    const serverId = (first(params.serverId) ?? "").trim();
    const token = sessionData.session.access_token;

    return (
        <main className="min-h-svh bg-background">
            <header className="border-b border-white/10 bg-surface">
                <div className="site-container flex min-h-18 flex-wrap items-center justify-between gap-4 py-3">
                    <Link href="/" className="inline-flex items-center gap-2 font-label text-xs font-semibold uppercase tracking-[0.14em] text-foreground-muted transition-colors hover:text-gold">
                        <ArrowLeft aria-hidden="true" className="size-4" /> Back to site
                    </Link>
                    <nav aria-label="Administration" className="flex items-center gap-2">
                        <Link href="/admin" className="border border-white/15 px-3 py-2 font-label text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-foreground-muted hover:border-gold/40 hover:text-gold">
                            Members
                        </Link>
                        <span className="inline-flex items-center gap-2 border border-gold/30 bg-gold/8 px-3 py-2 font-label text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-gold">
                            <CloudCog aria-hidden="true" className="size-4" /> Control Plane
                        </span>
                    </nav>
                </div>
            </header>

            <div className="site-container py-10 sm:py-14">
                <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
                    <div>
                        <p className="font-label text-xs font-semibold uppercase tracking-[0.22em] text-gold">Managed hosting command</p>
                        <h1 className="mt-3 font-display text-4xl font-semibold text-foreground sm:text-5xl">Control Plane</h1>
                        <p className="mt-3 max-w-3xl text-sm leading-6 text-foreground-muted">
                            Fleet state and every supported administrator operation come from the durable control plane. Requests are reauthorized, generation-checked, idempotent, and audited at execution time.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 text-gold">
                        <ShieldCheck aria-hidden="true" className="size-5" />
                        <span className="font-label text-xs font-semibold uppercase tracking-[0.16em]">Admin only</span>
                    </div>
                </div>

                <ViewTabs active={view} />
                <Suspense
                    key={`${view}:${query}:${serverId}`}
                    fallback={<ControlPlaneViewSkeleton view={view} />}
                >
                    <ControlPlaneViewContent
                        token={token}
                        view={view}
                        query={query}
                        serverId={serverId}
                    />
                </Suspense>
            </div>
        </main>
    );
}

async function ControlPlaneViewContent({
    token,
    view,
    query,
    serverId,
}: {
    token: string;
    view: View;
    query: string;
    serverId: string;
}) {
    let data: unknown = null;
    let discordUsers: DiscordUserSummary[] = [];
    let error = "";
    try {
        const needsDiscordUsers = view === "servers" || view === "server" || view === "operations";
        const [viewResult, usersResult] = await Promise.allSettled([
            loadView(token, view, query, serverId),
            needsDiscordUsers ? listDiscordUsers() : Promise.resolve({ users: [], truncated: false }),
        ]);
        if (viewResult.status === "rejected") throw viewResult.reason;
        data = viewResult.value;
        if (usersResult.status === "fulfilled") {
            discordUsers = usersResult.value.users;
        } else {
            console.error("Discord user directory failed to load", usersResult.reason);
        }
    } catch (cause) {
        console.error("Control plane admin view failed to load", cause);
        error = cause instanceof ControlPlaneAdminError
            ? cause.message
            : "The control plane view could not be loaded.";
    }

    return (
        <>
            {error && (
                <div role="alert" className="mt-7 border-l-2 border-crimson bg-crimson/10 px-4 py-3 text-sm text-red-200">
                    <p>{error}</p>
                    <p className="mt-1 text-xs text-red-200/70">No direct database or provider fallback was attempted.</p>
                </div>
            )}
            {!error && view === "overview" && <OverviewView overview={data as Overview} />}
            {!error && view === "vps" && <VpsView hosts={data as HostingAdminVpsHost[]} />}
            {!error && view === "servers" && <ServersView page={data as HostingPage<ManagedServer>} query={query} discordUsers={discordUsers} />}
            {!error && view === "server" && <ServerView result={data as ServerDashboardResult} discordUsers={discordUsers} />}
            {!error && view === "jobs" && <JobsView page={data as HostingPage<HostingJob>} />}
            {!error && view === "releases" && <ReleasesView data={data as { stable: HostingPage<ReleaseBuild>; nightly: HostingPage<ReleaseBuild> }} />}
            {!error && view === "audit" && <AuditView page={data as HostingPage<AuditEvent>} />}
            {!error && view === "operations" && <OperationsView overview={data as Overview} discordUsers={discordUsers} />}
        </>
    );
}

async function loadView(token: string, view: View, query: string, serverId: string) {
    switch (view) {
        case "overview":
        case "operations":
            return requestControlPlaneAdmin<Overview>({ accessToken: token, operation: "overview" });
        case "vps":
            return requestControlPlaneAdmin<HostingAdminVpsHost[]>({ accessToken: token, operation: "vps-hosts" });
        case "servers":
            return requestControlPlaneAdmin<HostingPage<ManagedServer>>({
                accessToken: token,
                operation: "servers",
                input: { filter: query ? { query } : {}, cursor: null, limit: 100 },
            });
        case "server":
            if (!serverId) throw new ControlPlaneAdminError("server_required", "Select a server first.");
            return requestControlPlaneAdmin<ServerDashboardResult>({
                accessToken: token,
                operation: "server-dashboard",
                input: { serverId },
            });
        case "jobs":
            return requestControlPlaneAdmin<HostingPage<HostingJob>>({
                accessToken: token,
                operation: "jobs",
                input: { filter: {}, cursor: null, limit: 100 },
            });
        case "releases": {
            const [stable, nightly] = await Promise.all([
                requestControlPlaneAdmin<HostingPage<ReleaseBuild>>({ accessToken: token, operation: "builds", input: { channel: "stable", cursor: null, limit: 100 } }),
                requestControlPlaneAdmin<HostingPage<ReleaseBuild>>({ accessToken: token, operation: "builds", input: { channel: "nightly", cursor: null, limit: 100 } }),
            ]);
            return { stable, nightly };
        }
        case "audit":
            return requestControlPlaneAdmin<HostingPage<AuditEvent>>({ accessToken: token, operation: "audit", input: { cursor: null, limit: 100 } });
    }
}

function ViewTabs({ active }: { active: View }) {
    const tabs: Array<{ view: View; label: string; icon: typeof Activity }> = [
        { view: "overview", label: "Overview", icon: Activity },
        { view: "vps", label: "VPS", icon: Cloud },
        { view: "servers", label: "Servers", icon: ServerCog },
        { view: "jobs", label: "Jobs", icon: BriefcaseBusiness },
        { view: "releases", label: "Releases", icon: PackageCheck },
        { view: "audit", label: "Audit", icon: History },
        { view: "operations", label: "Operations", icon: ListChecks },
    ];
    return (
        <nav aria-label="Control plane" className="mt-9 flex gap-2 overflow-x-auto border-b border-white/10 pb-3">
            {tabs.map(({ view, label, icon: Icon }) => (
                <Link
                    key={view}
                    href={`/admin/control-plane?view=${view}`}
                    aria-current={active === view || (active === "server" && view === "servers") ? "page" : undefined}
                    className={`inline-flex min-h-10 shrink-0 items-center gap-2 border px-4 font-label text-[0.68rem] font-semibold uppercase tracking-[0.12em] ${active === view || (active === "server" && view === "servers") ? "border-gold/40 bg-gold/10 text-gold" : "border-white/10 text-foreground-muted hover:border-white/25 hover:text-foreground"}`}
                >
                    <Icon aria-hidden="true" className="size-3.5" /> {label}
                </Link>
            ))}
        </nav>
    );
}

function VpsView({ hosts }: { hosts: HostingAdminVpsHost[] }) {
    const checkedAt = hosts.find((host) => host.providerCheckedAt)?.providerCheckedAt ?? null;
    return (
        <section className="mt-8">
            <SectionHeading eyebrow="OVHcloud inventory" title="VPS hosts" count={hosts.length} />
            <p className="mt-3 text-xs text-foreground-muted">
                Capacity combines registered control-plane slots with live read-only OVH account billing data.
                {checkedAt ? ` Provider data checked ${formatDate(checkedAt)}.` : ""}
            </p>
            <div className="mt-6 overflow-x-auto border border-white/10 bg-surface">
                <table className="w-full min-w-250 text-left text-sm">
                    <thead className="border-b border-white/10 font-label text-[0.65rem] uppercase tracking-[0.12em] text-foreground-muted">
                        <tr>
                            <th className="p-4">Name</th>
                            <th className="p-4">Region</th>
                            <th className="p-4">Running Servers</th>
                            <th className="p-4">Available Servers</th>
                            <th className="p-4">Cost</th>
                            <th className="p-4">Expiration Date</th>
                            <th className="p-4">Auto-Renew</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">{hosts.map((host) => (
                        <tr key={host.name} className="hover:bg-white/[0.025]">
                            <td className="p-4 font-mono text-xs text-foreground">{host.name}</td>
                            <td className="p-4 text-xs text-foreground-muted">{host.region}</td>
                            <td className="p-4 font-display text-xl text-foreground">{host.runningServers}</td>
                            <td className="p-4 font-display text-xl text-foreground">{host.availableServers}</td>
                            <td className="p-4 text-xs text-foreground-muted">{formatVpsCost(host.cost)}</td>
                            <td className="p-4 text-xs text-foreground-muted">{host.expirationDate ? formatDate(host.expirationDate) : "Unknown"}</td>
                            <td className="p-4"><State value={host.autoRenew === true ? "enabled" : host.autoRenew === false ? "disabled" : "unknown"} /></td>
                        </tr>
                    ))}</tbody>
                </table>
                {hosts.length === 0 && <Empty>No registered OVH VPS hosts.</Empty>}
            </div>
        </section>
    );
}

function OverviewView({ overview }: { overview: Overview }) {
    const { fleet, controls } = overview;
    const stats = [
        { label: "Running", value: fleet.running, view: "servers", help: stateExplanation("running") },
        { label: "Stopped", value: fleet.stopped, view: "servers", help: stateExplanation("stopped") },
        { label: "Suspended", value: fleet.suspended, view: "servers", help: stateExplanation("suspended") },
        { label: "Provisioning", value: fleet.provisioning, view: "servers", help: stateExplanation("provisioning") },
        { label: "Failed / degraded", value: fleet.failedOrDegraded, view: "servers", help: `${stateExplanation("failed")} ${stateExplanation("degraded")}` },
        { label: "Active jobs", value: fleet.activeJobs, view: "jobs", help: "Durable jobs that are queued, running, or waiting to retry." },
        { label: "Unhealthy agents", value: fleet.agentUnhealthyOrUnknown, view: "servers", help: "Servers whose runner agent is unhealthy or lacks current trustworthy evidence." },
        { label: "Pending deletion", value: fleet.pendingDeletion, view: "servers", help: stateExplanation("deletion-pending") },
        { label: "Backup failures", value: fleet.backupFailures, view: "jobs", help: "Recent backup jobs that need administrator review." },
    ] as const;
    return (
        <div className="mt-8 space-y-8">
            <section className="grid gap-px border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
                {stats.map((stat) => <Stat key={stat.label} {...stat} />)}
            </section>
            <section className="grid gap-6 lg:grid-cols-2">
                <Panel title="Provider and reconciliation">
                    <Definition label="Provider" value={fleet.provider.mode} />
                    <Definition label="API health" value={fleet.provider.apiHealth} />
                    <Definition label="Capacity" value={fleet.provider.capacityAvailable ? "Available" : "Unavailable"} />
                    <Definition label="Managed instances" value={formatNullable(fleet.provider.managedInstanceCount)} />
                    <Definition label="Orphan candidates" value={String(fleet.provider.orphanCandidateCount)} />
                    <Definition label="Last reconciled" value={formatDate(fleet.lastReconciledAt)} />
                </Panel>
                <Panel title="Global controls">
                    {controlRows(controls).map(([label, paused]) => <Definition key={label} label={label} value={paused ? "Paused" : "Enabled"} tone={paused ? "warning" : "ok"} />)}
                    <Definition label="Last reason" value={controls.reason ?? "No override recorded"} />
                </Panel>
            </section>
            <section>
                <SectionHeading eyebrow="Durable queue" title="Recent jobs" count={overview.jobs.items.length} />
                <JobsTable jobs={overview.jobs.items.slice(0, 12)} />
            </section>
        </div>
    );
}

function ServersView({ page, query, discordUsers }: { page: HostingPage<ManagedServer>; query: string; discordUsers: DiscordUserSummary[] }) {
    const usernames = discordUsernameMap(discordUsers);
    return (
        <section className="mt-8">
            <form method="get" className="flex max-w-xl gap-2">
                <input type="hidden" name="view" value="servers" />
                <input name="q" defaultValue={query} placeholder="Name, owner, server, provider resource…" className="min-h-11 flex-1 border border-white/15 bg-surface px-3 text-sm text-foreground outline-none placeholder:text-foreground-dim focus:border-gold" />
                <button className="border border-crimson bg-crimson px-5 font-label text-xs font-semibold uppercase tracking-[0.12em] text-white">Search</button>
            </form>
            <div className="mt-6 overflow-x-auto border border-white/10 bg-surface">
                <table className="w-full min-w-260 text-left text-sm">
                    <thead className="border-b border-white/10 font-label text-[0.65rem] uppercase tracking-[0.12em] text-foreground-muted"><tr><th className="p-4">Server</th><th className="p-4">Owner</th><th className="p-4">State</th><th className="p-4">Runtime</th><th className="p-4">Release</th><th className="p-4">Provider</th><th className="p-4">Updated</th></tr></thead>
                    <tbody className="divide-y divide-white/10">{page.items.map((server) => (
                        <tr key={server.serverId} className="hover:bg-white/[0.025]">
                            <td className="p-4"><Link className="font-semibold text-gold hover:underline" href={`/admin/control-plane?view=server&serverId=${server.serverId}`}>{server.displayName}</Link><p className="mt-1 font-mono text-[0.65rem] text-foreground-dim">{server.serverId}</p></td>
                            <td className="p-4 text-xs text-foreground-muted"><p className="font-semibold text-foreground">{formatDiscordUsername(usernames.get(server.ownerDiscordUserId))}</p><p className="mt-1 font-mono text-[0.65rem] text-foreground-dim">{server.ownerDiscordUserId}</p></td>
                            <td className="p-4"><State value={server.operationState} /></td>
                            <td className="p-4 text-xs text-foreground-muted">{server.observedVmState} / {server.observedGameState}</td>
                            <td className="p-4 text-xs text-foreground-muted">{server.releaseChannel}<br />{shortId(server.installedBuildId)}</td>
                            <td className="p-4 text-xs text-foreground-muted">{server.provider}<br />{shortId(server.providerResourceId)}</td>
                            <td className="p-4 text-xs text-foreground-muted">{formatDate(server.updatedAt)}</td>
                        </tr>
                    ))}</tbody>
                </table>
                {page.items.length === 0 && <Empty>No managed servers match this filter.</Empty>}
            </div>
        </section>
    );
}

function ServerView({ result, discordUsers }: { result: ServerDashboardResult; discordUsers: DiscordUserSummary[] }) {
    const { server } = result.dashboard;
    const username = discordUsernameMap(discordUsers).get(server.ownerDiscordUserId);
    return (
        <div className="mt-8 space-y-8">
            <section className="flex flex-col justify-between gap-5 border border-white/10 bg-surface p-5 lg:flex-row lg:items-start">
                <div><p className="font-label text-[0.65rem] uppercase tracking-[0.14em] text-gold">Managed server</p><h2 className="mt-2 font-display text-3xl font-semibold text-foreground">{server.displayName}</h2><p className="mt-2 font-mono text-xs text-foreground-dim">{server.serverId}</p></div>
                <State value={server.operationState} />
            </section>
            <section className="grid gap-6 lg:grid-cols-3">
                <Panel title="Ownership"><Definition label="Discord owner" value={formatDiscordUsername(username)} /><Definition label="Discord ID" value={server.ownerDiscordUserId} /><Definition label="Region" value={server.friendlyRegion} /><Definition label="Provider" value={server.provider} /><Definition label="Resource" value={server.providerResourceId ?? "Unassigned"} /></Panel>
                <Panel title="Desired / observed"><Definition label="Desired" value={server.desiredState} /><Definition label="VM" value={server.observedVmState} /><Definition label="Game" value={server.observedGameState} /><Definition label="Agent" value={result.dashboard.runtime?.agentHealthy ? "Healthy" : "Unavailable"} tone={result.dashboard.runtime?.agentHealthy ? "ok" : "warning"} /></Panel>
                <Panel title="Composition"><Definition label="Channel" value={server.releaseChannel} /><Definition label="Installed" value={server.installedBuildId ?? "None"} /><Definition label="Desired" value={server.desiredBuildId ?? "None"} /><Definition label="Pinned" value={server.pinnedBuildId ?? "None"} /><Definition label="Save" value={result.dashboard.activeSave?.displayName ?? "Default bootstrap pending"} /></Panel>
            </section>
            <section><SectionHeading eyebrow="Recovery" title="Backups" count={result.backups.items.length} /><BackupsTable backups={result.backups.items} /></section>
            <section><SectionHeading eyebrow="Trace" title="Server audit" count={result.audit.items.length} /><AuditTable events={result.audit.items} /></section>
        </div>
    );
}

function JobsView({ page }: { page: HostingPage<HostingJob> }) { return <section className="mt-8"><SectionHeading eyebrow="Durable queue" title="Jobs" count={page.items.length} /><JobsTable jobs={page.items} /></section>; }
function AuditView({ page }: { page: HostingPage<AuditEvent> }) { return <section className="mt-8"><SectionHeading eyebrow="Hash-chained history" title="Audit events" count={page.items.length} /><AuditTable events={page.items} /></section>; }

function ReleasesView({ data }: { data: { stable: HostingPage<ReleaseBuild>; nightly: HostingPage<ReleaseBuild> } }) {
    const stable = installableBuilds(data.stable.items);
    const nightly = installableBuilds(data.nightly.items);
    const hiddenStable = data.stable.items.length - stable.length;
    const hiddenNightly = data.nightly.items.length - nightly.length;
    return <div className="mt-8 grid gap-8 xl:grid-cols-2"><section><SectionHeading eyebrow="Validated release channel" title="Stable" count={stable.length} /><ReleaseHistoryNote hidden={hiddenStable} /><BuildTable builds={stable} /></section><section><SectionHeading eyebrow="Validated release channel" title="Nightly" count={nightly.length} /><ReleaseHistoryNote hidden={hiddenNightly} /><BuildTable builds={nightly} /></section></div>;
}

function OperationsView({ overview, discordUsers }: { overview: Overview; discordUsers: DiscordUserSummary[] }) {
    const serverOptions: AdminActionOption[] = overview.servers.items.map((server) => ({ label: `${server.displayName} · ${server.operationState}`, value: server.serverId, updatedAt: server.updatedAt }));
    const serverPlainOptions = serverOptions.map(({ label, value }) => ({ label, value }));
    const jobOptions: AdminActionOption[] = overview.jobs.items.map((job) => ({ label: `${job.action} · ${job.state} · ${shortId(job.jobId)}`, value: job.jobId, updatedAt: job.updatedAt }));
    const buildOptions = [...overview.stableBuilds.items, ...overview.nightlyBuilds.items].map((build) => ({ label: `${build.channel} · ${build.version} · ${build.validationState}`, value: build.buildId }));
    const discordUserOptions: AdminActionOption[] = discordUsers.map((user) => ({ label: user.username, value: user.discordUserId }));
    const discordUserField = (name: string, label: string): AdminActionField => ({ name, label, kind: "discord-user", required: true, options: discordUserOptions, help: "Enter the account's unique Discord username or its numeric Discord user ID. The username must belong to a user who has signed into this website with Discord." });
    const reasonField: AdminActionField = { name: "reason", label: "Reason", kind: "textarea", required: true, placeholder: "Why this administrative action is necessary", help: "Stored in the immutable administrative audit event." };
    const serverField: AdminActionField = { name: "serverId", label: "Server", kind: "server", required: true, options: serverOptions, help: "The selected row carries its current update generation so a stale action fails safely." };
    const plainServerField: AdminActionField = { name: "serverId", label: "Server", kind: "select", required: true, options: serverPlainOptions };
    const compatibilityField: AdminActionField = { name: "allowCompatibilityOverride", label: "Override unknown save compatibility", kind: "checkbox", help: "Use only after reviewing the save and build. This permits an unknown compatibility result; it does not bypass a known incompatibility." };
    const cards: Array<{ group: string; operation: string; title: string; description: string; fields: AdminActionField[]; destructive?: boolean }> = [
        { group: "Fleet", operation: "create-server", title: "Create server", description: "Assign one prepared slot from existing registered OVH capacity. This never orders or bills a new VPS; unavailable regional capacity makes the request fail without creating anything.", fields: [
            discordUserField("ownerDiscordUserId", "Owner Discord username or ID"), { name: "ownerRoleIds", label: "Current Discord role IDs", valueType: "csv", placeholder: "Comma separated", help: "Current entitlement roles are rechecked by the control plane; these values cannot grant an entitlement on their own." },
            { name: "displayName", label: "Display name", required: true }, { name: "friendlyRegion", label: "Region", kind: "select", required: true, options: enumOptions(["germany", "united-kingdom", "spain", "united-states", "europe-automatic"]), help: "The scheduler uses only prepared slots in this region. If none are available, the request fails; no VPS is purchased automatically." },
            { name: "releaseChannel", label: "Release", kind: "select", required: true, options: enumOptions(["stable", "nightly"]) }, { name: "maintenanceSlot", label: "Maintenance slot", kind: "select", required: true, options: enumOptions(["03:00-04:00", "10:00-11:00", "18:00-19:00"]) },
        ] },
        { group: "Fleet", operation: "force-reconcile", title: "Force reconciliation", description: "Compare desired state with current provider and runner evidence, record drift, and queue only bounded repairs. It does not buy VPS products or start intentionally stopped servers.", fields: [] },
        { group: "Fleet", operation: "review-orphans", title: "Review provider orphans", description: "Create a read-only snapshot of provider resources that do not match managed state. Review never deletes or changes a provider resource.", fields: [] },
        { group: "Fleet", operation: "orphan-review", title: "Open orphan review", description: "Read a previously created review and its exact cleanup group digests.", fields: [{ name: "reviewId", label: "Review UUID", required: true }] },
        { group: "Fleet", operation: "cleanup-orphan", title: "Clean reviewed orphan group", description: "Queue cleanup only for an exact reviewed group digest.", destructive: true, fields: [{ name: "reviewId", label: "Review UUID", required: true }, { name: "groupSha256", label: "Group SHA-256", required: true }, reasonField] },
        { group: "Fleet", operation: "set-global-controls", title: "Global controls", description: `Replace all five live pause switches as one audited update. Role deletions are currently ${overview.controls.roleDeletionsPaused ? "paused" : "enabled"}.${overview.controls.reason ? ` Last recorded reason: ${overview.controls.reason}` : " No override reason is recorded."}`, fields: [
            { name: "provisioningPaused", label: "Pause provisioning", kind: "checkbox", defaultValue: overview.controls.provisioningPaused, help: "Checked means new server provisioning is currently paused." }, { name: "roleDeletionsPaused", label: "Pause role deletions", kind: "checkbox", defaultValue: overview.controls.roleDeletionsPaused, help: "Checked reflects the current durable safety control: automatic entitlement-loss deletions are paused until an administrator submits this card unchecked with a reason." },
            { name: "maintenancePaused", label: "Pause maintenance", kind: "checkbox", defaultValue: overview.controls.maintenancePaused, help: "Checked means scheduled maintenance work is paused." }, { name: "automaticBackupsPaused", label: "Pause automatic backups", kind: "checkbox", defaultValue: overview.controls.automaticBackupsPaused, help: "Checked means scheduled automatic backups are paused; manual backup operations remain separately controlled." },
            { name: "nightlyRolloutsPaused", label: "Pause Nightly rollouts", kind: "checkbox", defaultValue: overview.controls.nightlyRolloutsPaused, help: "Checked means automatic Nightly rollout work is paused." }, reasonField,
        ] },
        { group: "Server lifecycle", operation: "server-operation", title: "Lifecycle operation", description: "Start, stop, restart, delete, reboot, or emergency-stop a current server generation.", destructive: true, fields: [serverField, { name: "action", label: "Action", kind: "select", required: true, options: enumOptions(["start", "stop", "restart-game", "delete", "reboot-vm", "force-stop"]) }, reasonField] },
        { group: "Server lifecycle", operation: "update-server", title: "Update server", description: "Resolve the selected channel to a verified immutable build and queue an update.", fields: [serverField, compatibilityField, reasonField] },
        { group: "Server lifecycle", operation: "rollback-server", title: "Rollback server", description: "Queue the reviewed rollback path for the current generation.", destructive: true, fields: [serverField, compatibilityField, reasonField] },
        { group: "Server lifecycle", operation: "restore-backup", title: "Restore backup", description: "Restore an exact backup after current-state validation.", destructive: true, fields: [serverField, { name: "backupId", label: "Backup UUID", required: true }, reasonField] },
        { group: "Server lifecycle", operation: "collect-diagnostics", title: "Collect diagnostics", description: "Queue bounded, sanitized diagnostics. Raw secrets and arbitrary files remain inaccessible.", fields: [serverField, { name: "lookbackSeconds", label: "Lookback seconds", kind: "number", required: true, minimum: 60, maximum: 86400, defaultValue: 3600 }, reasonField] },
        { group: "Server lifecycle", operation: "update-settings", title: "Change release settings", description: "Change channel and/or maintenance slot with a stale-state guard.", fields: [serverField, { name: "patch.releaseChannel", label: "Release channel", kind: "select", options: enumOptions(["stable", "nightly"]) }, { name: "patch.maintenanceSlot", label: "Maintenance slot", kind: "select", options: enumOptions(["03:00-04:00", "10:00-11:00", "18:00-19:00"]) }, compatibilityField, reasonField] },
        { group: "Server lifecycle", operation: "set-build-pin", title: "Set build pin", description: "Pin an exact catalog build, or leave blank to return to channel resolution.", fields: [serverField, { name: "buildId", label: "Build pin", kind: "select", valueType: "nullable", options: buildOptions }, compatibilityField, reasonField] },
        { group: "Server lifecycle", operation: "reset-password", title: "Reset game password", description: "Generate a password or set a custom value; generated output is shown once.", destructive: true, fields: [serverField, { name: "choice.kind", label: "Password source", kind: "select", required: true, options: enumOptions(["generated", "custom"]) }, { name: "choice.password", label: "Custom password", kind: "password", placeholder: "Required only for custom" }, reasonField] },
        { group: "Server lifecycle", operation: "suspend-server", title: "Suspend server", description: "Durably suspend owner operations and queue a safe stop.", destructive: true, fields: [plainServerField, reasonField] },
        { group: "Server lifecycle", operation: "reactivate-server", title: "Reactivate server", description: "Clear administrative suspension after entitlement checks.", fields: [plainServerField, reasonField] },
        { group: "Server lifecycle", operation: "extend-deletion", title: "Extend pending deletion", description: "Move a pending deletion deadline forward by a bounded number of hours.", fields: [serverField, { name: "extensionHours", label: "Extension hours", kind: "number", required: true, minimum: 1, maximum: 8760 }, reasonField] },
        { group: "Server lifecycle", operation: "cancel-deletion", title: "Cancel pending deletion", description: "Cancel the pending deletion if current entitlement permits it.", fields: [serverField, reasonField] },
        { group: "Server lifecycle", operation: "execute-deletion", title: "Execute pending deletion", description: "Queue the final deletion path now.", destructive: true, fields: [serverField, reasonField] },
        { group: "Ownership and capacity", operation: "set-bonus-quota", title: "Set bonus quota", description: "Replace an owner’s administrative bonus server quota.", fields: [discordUserField("targetDiscordUserId", "Discord username or ID"), { name: "bonusQuota", label: "Bonus quota", kind: "number", required: true, minimum: 0, maximum: 100 }, reasonField] },
        { group: "Ownership and capacity", operation: "transfer-owner", title: "Transfer ownership", description: "Transfer a server or queue the required replacement workflow.", destructive: true, fields: [serverField, discordUserField("recipientDiscordUserId", "Recipient Discord username or ID"), { name: "recipientRoleIds", label: "Recipient role IDs", valueType: "csv", placeholder: "Comma separated" }, reasonField] },
        { group: "Ownership and capacity", operation: "set-manager", title: "Set manager", description: "Grant or revoke manager access for one Discord user.", fields: [plainServerField, discordUserField("managerDiscordUserId", "Manager Discord username or ID"), { name: "enabled", label: "Grant access (unchecked revokes)", kind: "checkbox", defaultValue: true }, reasonField] },
        { group: "Ownership and capacity", operation: "replace-provider", title: "Replace provider generation", description: "Queue a resize, rebuild, or region migration with backup/restore and atomic cutover gates.", destructive: true, fields: [serverField, { name: "selection.action", label: "Replacement", kind: "select", required: true, options: enumOptions(["resize", "rebuild", "migrate-region"]) }, { name: "selection.targetSizeId", label: "Target size ID", placeholder: "Resize only" }, { name: "selection.targetImageId", label: "Target image ID", placeholder: "Rebuild only" }, { name: "selection.targetFriendlyRegion", label: "Target region", kind: "select", options: enumOptions(["germany", "united-kingdom", "spain", "united-states", "europe-automatic"]) }, reasonField] },
        { group: "Jobs", operation: "retry-job", title: "Retry job", description: "Move an eligible failed/retry-wait job back to the durable queue.", fields: [{ name: "jobId", label: "Job", kind: "job", required: true, options: jobOptions }, reasonField] },
        { group: "Jobs", operation: "cancel-job", title: "Cancel job", description: "Request cancellation at the next safe checkpoint.", destructive: true, fields: [{ name: "jobId", label: "Job", kind: "job", required: true, options: jobOptions }, reasonField] },
        { group: "Jobs", operation: "diagnostics", title: "Open diagnostics result", description: "Read the sanitized result of a completed diagnostics job.", fields: [{ name: "jobId", label: "Diagnostics job UUID", required: true }] },
        { group: "Releases and communication", operation: "batch-maintenance", title: "Batch maintenance", description: "Queue updates for a bounded fleet snapshot, optionally limited to one channel.", fields: [{ name: "releaseChannel", label: "Channel", kind: "select", valueType: "nullable", options: enumOptions(["stable", "nightly"]) }, reasonField] },
        { group: "Releases and communication", operation: "announce-owners", title: "Announce to owners", description: "Queue a durable private notification campaign for entitled owners.", fields: [{ name: "message", label: "Message", kind: "textarea", required: true }, reasonField] },
        ...(["inspect", "validate", "reject", "revoke"] as const).map((verb) => ({ group: "Releases and communication", operation: `${verb}-build`, title: `${capitalize(verb)} build`, description: `${capitalize(verb)} one exact release catalog build with an audit reason.`, destructive: verb === "reject" || verb === "revoke", fields: [{ name: "buildId", label: "Build", kind: "select" as const, required: true, options: buildOptions }, reasonField] })),
    ];
    const groups = [...new Set(cards.map((card) => card.group))];
    return <div className="mt-8 space-y-12">{groups.map((group) => <section key={group}><SectionHeading eyebrow="Administrative actions" title={group} count={cards.filter((card) => card.group === group).length} /><div className="grid auto-rows-fr gap-5 md:grid-cols-2 xl:grid-cols-3">{cards.filter((card) => card.group === group).map((card) => <ControlPlaneActionCard key={card.operation} {...card} help={operationExplanation(card.operation)} destructiveReason={card.destructive ? destructiveExplanation(card.operation) : undefined} />)}</div></section>)}</div>;
}

function JobsTable({ jobs }: { jobs: HostingJob[] }) { return <div className="mt-4 overflow-x-auto border border-white/10 bg-surface"><table className="w-full min-w-230 text-left text-sm"><thead className="border-b border-white/10 font-label text-[0.65rem] uppercase tracking-[0.12em] text-foreground-muted"><tr><th className="p-4">Action</th><th className="p-4">State</th><th className="p-4">Server</th><th className="p-4">Progress</th><th className="p-4">Attempts</th><th className="p-4">Updated</th></tr></thead><tbody className="divide-y divide-white/10">{jobs.map((job) => { const explanation = jobActionExplanation(job.action); return <tr key={job.jobId}><td className="p-4"><p className="cursor-help font-semibold text-foreground" title={explanation} aria-label={`${job.action}: ${explanation}`}>{job.action}</p><p className="font-mono text-[0.62rem] text-foreground-dim">{job.jobId}</p></td><td className="p-4"><State value={job.state} /></td><td className="p-4 font-mono text-xs text-foreground-muted">{shortId(job.serverId)}</td><td className="p-4 text-xs text-foreground-muted">{job.progressStage}{job.errorCode ? ` · ${job.errorCode}` : ""}</td><td className="p-4 text-xs text-foreground-muted">{job.attemptCount}/{job.maximumAttempts}</td><td className="p-4 text-xs text-foreground-muted">{formatDate(job.updatedAt)}</td></tr>; })}</tbody></table>{jobs.length === 0 && <Empty>No jobs in this view.</Empty>}</div>; }
function BackupsTable({ backups }: { backups: Backup[] }) { return <div className="mt-4 overflow-x-auto border border-white/10 bg-surface"><table className="w-full min-w-200 text-left text-sm"><thead className="border-b border-white/10 font-label text-[0.65rem] uppercase tracking-[0.12em] text-foreground-muted"><tr><th className="p-4">Backup</th><th className="p-4">Type</th><th className="p-4">State</th><th className="p-4">Size</th><th className="p-4">Created</th><th className="p-4">Expires</th></tr></thead><tbody className="divide-y divide-white/10">{backups.map((backup) => <tr key={backup.backupId}><td className="p-4 font-mono text-xs text-foreground-muted">{backup.backupId}</td><td className="p-4 text-xs text-foreground-muted">{backup.backupType}</td><td className="p-4"><State value={backup.restoreState} /></td><td className="p-4 text-xs text-foreground-muted">{formatBytes(backup.byteSize)}</td><td className="p-4 text-xs text-foreground-muted">{formatDate(backup.createdAt)}</td><td className="p-4 text-xs text-foreground-muted">{formatDate(backup.retentionExpiresAt)}</td></tr>)}</tbody></table>{backups.length === 0 && <Empty>No retained backups.</Empty>}</div>; }
function AuditTable({ events }: { events: AuditEvent[] }) { return <div className="mt-4 overflow-x-auto border border-white/10 bg-surface"><table className="w-full min-w-240 text-left text-sm"><thead className="border-b border-white/10 font-label text-[0.65rem] uppercase tracking-[0.12em] text-foreground-muted"><tr><th className="p-4">Time</th><th className="p-4">Action</th><th className="p-4">Actor</th><th className="p-4">Server</th><th className="p-4">Reason</th><th className="p-4">Correlation</th></tr></thead><tbody className="divide-y divide-white/10">{events.map((event) => <tr key={event.eventId}><td className="p-4 text-xs text-foreground-muted">{formatDate(event.occurredAt)}</td><td className="p-4 text-xs font-semibold text-foreground">{event.action}</td><td className="p-4 text-xs text-foreground-muted">{event.actorType}<br />{shortId(event.actorId)}</td><td className="p-4 font-mono text-xs text-foreground-muted">{shortId(event.targetServerId)}</td><td className="max-w-80 p-4 text-xs text-foreground-muted">{event.reason ?? "—"}</td><td className="p-4 font-mono text-[0.62rem] text-foreground-dim">{shortId(event.correlationId)}</td></tr>)}</tbody></table>{events.length === 0 && <Empty>No audit events in this view.</Empty>}</div>; }
function BuildTable({ builds }: { builds: ReleaseBuild[] }) { return <div className="mt-4 overflow-x-auto border border-white/10 bg-surface"><table className="w-full min-w-180 text-left text-sm"><thead className="border-b border-white/10 font-label text-[0.65rem] uppercase tracking-[0.12em] text-foreground-muted"><tr><th className="p-4">Version</th><th className="p-4">Commit</th><th className="p-4">Validation</th><th className="p-4">Game</th><th className="p-4">Published</th></tr></thead><tbody className="divide-y divide-white/10">{builds.map((build) => <tr key={build.buildId}><td className="p-4"><p className="font-semibold text-foreground">{build.version}</p><p className="font-mono text-[0.62rem] text-foreground-dim">{build.buildId}</p></td><td className="p-4 font-mono text-xs text-foreground-muted" title={build.sourceRevision}>{shortRevision(build.sourceRevision)}</td><td className="p-4"><State value={build.validationState} /></td><td className="p-4 text-xs text-foreground-muted">{build.supportedGameVersion}</td><td className="p-4 text-xs text-foreground-muted">{formatDate(build.publishedAt)}</td></tr>)}</tbody></table>{builds.length === 0 && <Empty>No validated builds in this channel.</Empty>}</div>; }

function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="border border-white/10 bg-surface p-5"><h2 className="font-display text-2xl font-semibold text-foreground">{title}</h2><dl className="mt-4 divide-y divide-white/10">{children}</dl></section>; }
function Definition({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warning" }) { return <div className="flex items-start justify-between gap-4 py-3 text-xs"><dt className="text-foreground-muted">{label}</dt><dd className={`max-w-[65%] break-words text-right font-medium ${tone === "ok" ? "text-emerald-300" : tone === "warning" ? "text-amber-300" : "text-foreground"}`}>{value}</dd></div>; }
function Stat({ label, value, view, help }: { label: string; value: number; view: "servers" | "jobs"; help: string }) { return <Link href={`/admin/control-plane?view=${view}`} className="group bg-surface px-5 py-4 outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-gold" title={help} aria-label={`${label}: ${value}. ${help} Open ${view}.`}><p className="font-display text-3xl font-semibold text-foreground">{value}</p><p className="mt-1 font-label text-[0.62rem] font-semibold uppercase tracking-[0.13em] text-foreground-muted group-hover:text-gold">{label}</p></Link>; }
function SectionHeading({ eyebrow, title, count }: { eyebrow: string; title: string; count: number }) { return <div className="flex items-end justify-between gap-4"><div><p className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-gold">{eyebrow}</p><h2 className="mt-1 font-display text-3xl font-semibold text-foreground">{title}</h2></div><span className="font-display text-xl text-foreground-muted">{count}</span></div>; }
function State({ value }: { value: string }) { const good = ["running", "succeeded", "validated", "available", "healthy"].includes(value); const bad = ["failed", "degraded", "revoked", "rejected", "cancelled", "unavailable"].includes(value); const explanation = stateExplanation(value); return <span title={explanation} aria-label={`${value}: ${explanation}`} className={`inline-flex cursor-help border px-2 py-1 font-label text-[0.62rem] font-semibold uppercase tracking-[0.1em] ${good ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : bad ? "border-crimson/30 bg-crimson/10 text-red-200" : "border-gold/25 bg-gold/8 text-gold"}`}>{value}</span>; }
function Empty({ children }: { children: React.ReactNode }) { return <div className="px-6 py-12 text-center text-sm text-foreground-muted">{children}</div>; }

function ReleaseHistoryNote({ hidden }: { hidden: number }) { return hidden > 0 ? <p className="mt-3 text-xs leading-5 text-foreground-muted">Showing installable validated builds. {hidden} non-validated historical {hidden === 1 ? "record is" : "records are"} hidden here; receipts and audit history remain available to the inspect/reject operations.</p> : <p className="mt-3 text-xs leading-5 text-foreground-muted">Only installable validated builds are shown.</p>; }

function controlRows(controls: GlobalControls): Array<[string, boolean]> { return [["Provisioning", controls.provisioningPaused], ["Role deletions", controls.roleDeletionsPaused], ["Maintenance", controls.maintenancePaused], ["Automatic backups", controls.automaticBackupsPaused], ["Nightly rollouts", controls.nightlyRolloutsPaused]]; }
function enumOptions(values: readonly string[]): AdminActionOption[] { return values.map((value) => ({ label: value, value })); }
function discordUsernameMap(users: readonly DiscordUserSummary[]) { return new Map(users.map((user) => [user.discordUserId, user.username])); }
function formatDiscordUsername(username: string | undefined) { return username ? `@${username}` : "Username unavailable"; }
function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
function parseView(value: string | undefined): View { return ["overview", "vps", "servers", "server", "jobs", "releases", "audit", "operations"].includes(value ?? "") ? value as View : "overview"; }
function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never"; }
function formatVpsCost(cost: HostingAdminVpsHost["cost"]) {
    if (!cost) return "Unknown";
    const amount = new Intl.NumberFormat("en", { style: "currency", currency: cost.currencyCode }).format(cost.priceInMicrocents / 100_000_000);
    const cadence = cost.interval === 1 && cost.duration === "P1M"
        ? "month"
        : cost.interval === 1 && cost.duration === "P1Y"
            ? "year"
            : `${cost.interval} × ${cost.duration}`;
    return `${amount} / ${cadence}`;
}
function formatNullable(value: number | null) { return value === null ? "Unknown" : String(value); }
function formatBytes(value: number) { return value < 1_048_576 ? `${Math.round(value / 1024)} KiB` : `${(value / 1_048_576).toFixed(1)} MiB`; }
function shortId(value: string | null) { return value ? (value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value) : "—"; }
function shortRevision(value: string) { return value.slice(0, 12); }
function capitalize(value: string) { return value[0]?.toUpperCase() + value.slice(1); }
