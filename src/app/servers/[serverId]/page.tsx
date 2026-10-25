import { isColdSleeping } from "@/app/lib/hosting/cold-sleep";
import type { Translator } from "@/app/lib/localization/types";
import { LocalizationProvider } from "@/app/lib/localization/client";
import { localizedRegionLabel } from "@/app/lib/hosting/region-labels";
import { getLocale, getMessages, getTranslations } from "@/app/lib/localization/server";
import { ManagedServerCommands } from "@/app/components/servers/ManagedServerCommands";
import { releaseChannelLabel } from "@/app/lib/control-plane/presentation";
import { ServerSettingsPanel } from "@/app/components/servers/ServerSettingsPanel";
import { ServerSaveConfigPanels } from "@/app/components/servers/ServerSaveConfigPanels";
import { ServerManagementWorkspace, ServerWorkspacePanel, ServerConsoleWorkspace, UnavailableServerConsole, UnavailableServerPanel } from "@/app/components/servers/ServerManagementWorkspace";
import { ServerVisibilitySetting } from "@/app/components/servers/ServerVisibilitySetting";
import { serverWorkspaceSectionFromTab, type ServerWorkspaceSection } from "@/app/components/servers/server-workspace-tabs";
import { connectionAddress } from "@/app/lib/hosting/connection-address";
import { ManagedServerFiles } from "@/app/components/servers/ManagedServerFiles";
import { getMyServerFiles } from "@/app/lib/hosting/server-files";
import { getMyServerSaveGenerations, listAllMyServerSaves } from "@/app/lib/hosting/my-servers";
import { ManagedServerControls, ManagedServerPassword } from "@/app/components/servers/ManagedServerControls";
import { ManagedServerPollingProvider } from "@/app/components/servers/ManagedServerPollingProvider";
import { ManagedServerMaintenanceProvider } from "@/app/components/servers/ManagedServerMaintenance";
import { ManagedServerDelete } from "@/app/components/servers/ManagedServerDelete";
import { ManagedServerMods } from "@/app/components/servers/ServerModsPanel";
import { readManagedServerStatusFingerprint } from "@/app/servers/managed-server-actions";
import { getMemberRole, hasHostedServerAccess } from "@/app/lib/auth/access";
import { hasServerFleetAccess } from "@/app/lib/auth/roles";
import type { MyServerMove, MyServerNotice, MyServerSummary } from "@/app/lib/control-plane/types";
import {
    getMyServerBackupStatus,
    MyServersApiError,
    listAllMyServerBackups,
    type MyServerDeletionStatus,
} from "@/app/lib/hosting/my-servers";
import { getMyServerDeletionStatus, getMyServerMoveStatus, getMyServerNotices, getMyServerSummary } from "@/app/lib/hosting/my-servers-server";
import { listServerManagers, type ServerManager } from "@/app/lib/hosting/server-managers";
import { isMoveInProgress } from "@/app/lib/hosting/server-move";
import { SubscriptionHoldNotice } from "@/app/components/servers/SubscriptionHoldNotice";
import { ManagedServerNoticeBanner } from "@/app/components/servers/ManagedServerNoticeBanner";
import { ManagedServerMoveProvider, ManagedServerMoveStatus } from "@/app/components/servers/ManagedServerMoveStatus";
import { getServerForRole } from "@/app/lib/hosting/servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { Container, HardDrive, MemoryStick, Server } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache, Suspense } from "react";

type ServerPageProps = {
    params: Promise<{ serverId: string }>;
    searchParams: Promise<{
        tab?: string | string[];
    }>;
};

// Selects the first existing query value without altering external feedback.
function firstValue(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
}

export const dynamic = "force-dynamic";
const INITIALIZING_SERVER_STATES = new Set(["provisioning", "configuring"]);

// Resolves metadata from the explicit website locale.
export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getTranslations("managed-server");
    return { title: t("page.metadataTitle"), description: t("page.metadataDescription") };
}

// Authorizes the requested server before resolving its available management capabilities.
async function AuthorizedServerPage({ params, searchParams }: ServerPageProps) {
    const { t } = await getTranslations("managed-server");
    const [{ serverId }, query] = await Promise.all([params, searchParams]);
    const supabase = await getSupabaseServerClient();
    const [{ data: userData }, { data: sessionData }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.auth.getSession(),
    ]);
    const user = userData.user;
    // A remembered tab renders on the server, so reloading does not flash the Console first.
    const rememberedSection = serverWorkspaceSectionFromTab(firstValue(query.tab));

    if (!user) redirect(`/login?next=/servers/${encodeURIComponent(serverId)}`);

    const accessToken = sessionData.session?.access_token ?? null;
    if (accessToken === null) redirect(`/login?next=/servers/${encodeURIComponent(serverId)}`);

    let managedServer: MyServerSummary | null = null;
    try {
        managedServer = await getMyServerSummary(accessToken, serverId);
    } catch (error) {
        const unknownServer = error instanceof MyServersApiError && ["invalid_request", "server_not_found", "forbidden"].includes(error.code);
        if (!unknownServer) {
            console.error("Managed server detail failed to load", error);
            throw error;
        }
    }

    if (managedServer !== null) {
        return <ManagedServerManagementPage userId={user.id} accessToken={accessToken} server={managedServer} initialSection={rememberedSection} />;
    }

    if (!hasHostedServerAccess(user)) redirect("/servers");

    const role = getMemberRole(user);
    const server = getServerForRole(serverId, role);
    if (!server) redirect("/servers");

    return <ServerManagementWorkspace
        name={<h1 id="server-heading" className="font-display text-2xl font-semibold sm:text-4xl">{server.name}</h1>}
        summary={t("page.previewSummary", { plan: server.plan, location: server.location })}
        notice={t("page.previewServerTheControlPlaneIsNotConnectedServerActionsAreUnavailable")}
        initialSection={rememberedSection}
    >
        <ServerWorkspacePanel section="Console"><ServerConsoleWorkspace><UnavailableServerConsole /></ServerConsoleWorkspace></ServerWorkspacePanel>
        <UnavailableFileWorkspaces />
        <ServerWorkspacePanel section="Settings">
            <ServerSettingsPanel name={server.name} />
            <section className="grid gap-3 sm:grid-cols-3" aria-label={t("page.serverInformation")}>
                <ResourceCard icon={MemoryStick} label={t("page.memory")} value={server.memory} />
                <ResourceCard icon={HardDrive} label={t("page.storage")} value={server.storage} />
                <ResourceCard icon={Server} label={t("page.version")} value={server.version} />
            </section>
            {hasServerFleetAccess(role) && <section className="rounded-lg border border-white/10 bg-surface p-5">
                <h2 className="text-base font-semibold">Assigned account</h2>
                <p>{server.assignedAccount.displayName}</p>
                <p className="break-all text-sm text-foreground-muted">{server.assignedAccount.email}</p>
                <p className="break-all font-mono text-xs text-foreground-muted">{server.assignedAccount.id}</p>
            </section>}
        </ServerWorkspacePanel>
    </ServerManagementWorkspace>;
}

// Composes inert file panels for servers without a connected control plane.
async function UnavailableFileWorkspaces() {
    const { t } = await getTranslations("managed-server");
    return <>
        <ServerWorkspacePanel section="Backups"><UnavailableServerPanel title={t("page.backups")} actions={[t("page.createBackup"), t("page.restoreBackup")]} /></ServerWorkspacePanel>
        <ServerWorkspacePanel section="Save & config">
            <ServerSaveConfigPanels />
        </ServerWorkspacePanel>
        <ServerWorkspacePanel section="Mods"><UnavailableServerPanel title={t("mods.heading")} actions={[t("mods.upload")]} /></ServerWorkspacePanel>
    </>;
}

/** Composes the managed workspace with compact runtime metadata and task-specific panels. */
async function ManagedServerManagementPage({ userId, accessToken, server, initialSection }: {
    userId: string; accessToken: string; server: MyServerSummary; initialSection?: ServerWorkspaceSection;
}) {
    const { t } = await getTranslations("managed-server");
    // Region names live with onboarding in the servers namespace, so both pages share one translation.
    const { t: tServers } = await getTranslations("servers");
    const [deletionStatus, notices, move, managers] = await Promise.all([
        server.accessRole === "owner"
            ? getMyServerDeletionStatus(accessToken, server.serverId, AbortSignal.timeout(5_000)).catch(() => null)
            : null,
        readServerNotices(accessToken, server.serverId),
        readServerMoveStatus(accessToken, server.serverId),
        server.accessRole === "owner" ? readServerManagers(accessToken, server.serverId) : null,
    ]);
    const initializing = INITIALIZING_SERVER_STATES.has(server.operationState);
    const managedAccessLabels: Record<MyServerSummary["accessRole"], string> = {
        admin: t("page.readOnlyAdministrator"),
        manager: t("page.manager"),
        owner: t("page.owner"),
        support: t("page.readOnlySupport"),
    };

    const address = connectionAddress(server.connectionIp ?? null, server.gamePorts ?? []);

    return <ManagedServerMoveProvider serverId={server.serverId} initialMove={move} headerAddress={address}><ServerManagementWorkspace
        name={<h1 id="server-heading" className="font-display text-2xl font-semibold sm:text-4xl">{server.displayName}</h1>}
        banner={server.subscriptionHold ? <><SubscriptionHoldNotice hold={server.subscriptionHold} isOwner={server.accessRole === "owner"} />{managedBanner(server.serverId, notices)}</> : managedBanner(server.serverId, notices)}
        initialSection={initializing ? "Console" : initialSection}
        interactionLocked={initializing}
        address={address}
        visibility={<ServerVisibilitySetting serverId={server.serverId} visibility={server.visibility} accessRole={server.accessRole} expectedUpdatedAt={server.updatedAt} disabled={initializing} />}
        summary={t("page.managedSummary", { region: localizedRegionLabel(tServers, server.friendlyRegion), access: managedAccessLabels[server.accessRole] })}
        status={<Suspense fallback={<ManagedServerStatus accessToken={accessToken} server={server} move={move} checkBackup={false} />}>
            <ManagedServerStatus accessToken={accessToken} server={server} move={move} checkBackup={server.accessRole === "owner" || server.accessRole === "manager"} />
        </Suspense>}
    >
        <ManagedServerSections userId={userId} accessToken={accessToken} server={server} deletionStatus={deletionStatus} managers={managers} />
        <ServerWorkspacePanel section="Mods">
            <ManagedServerMods key={`${userId}:${server.serverId}`} serverId={server.serverId} canManage={server.accessRole === "owner" || server.accessRole === "manager"} />
        </ServerWorkspacePanel>
    </ServerManagementWorkspace></ManagedServerMoveProvider>;
}

// Keeps managed controls, commands and output in the console workspace.
function ManagedServerSections({
    userId,
    accessToken,
    server,
    deletionStatus,
    managers,
}: {
    userId: string;
    accessToken: string;
    server: MyServerSummary;
    deletionStatus?: MyServerDeletionStatus | null;
    managers: readonly ServerManager[] | null;
}) {
    return (
        <ManagedServerPollingProvider readStatus={readManagedServerStatusFingerprint} initialServer={{ serverId: server.serverId, updatedAt: server.updatedAt, operationState: server.operationState }}>
            <ManagedServerMaintenanceProvider>
                <ServerWorkspacePanel section="Console">
                    {server.accessRole === "owner" || server.accessRole === "manager"
                        ? <ManagedServerCommands key={`${userId}:${server.serverId}`} server={server} userId={userId} controls={<ManagedServerLifecycleSection server={server} />} />
                        : <ServerConsoleWorkspace><UnavailableServerConsole controls={<ManagedServerLifecycleSection server={server} />} /></ServerConsoleWorkspace>}
                </ServerWorkspacePanel>
                <ServerWorkspacePanel section="Settings">
                    <ServerSettingsPanel settingsAccess={{ serverId: server.serverId, maintenanceSlot: server.maintenanceSlot, timezone: server.timezone, expectedUpdatedAt: server.updatedAt, canEdit: server.accessRole === "owner" }} releaseAccess={{ serverId: server.serverId, channel: server.releaseChannel, expectedUpdatedAt: server.updatedAt, canEdit: server.accessRole === "owner" }} managerAccess={{ serverId: server.serverId, expectedUpdatedAt: server.updatedAt, canEdit: server.accessRole === "owner", managers }} name={server.displayName} visibility={server.visibility ?? "private"} visibilityAccess={{ serverId: server.serverId, expectedUpdatedAt: server.updatedAt, canEdit: server.accessRole === "owner" }} />
                    <ManagedServerPassword serverId={server.serverId} accessRole={server.accessRole} operationState={server.operationState} expectedUpdatedAt={server.updatedAt} />
                    <ManagedServerDelete key={`${userId}:${server.serverId}`} serverId={server.serverId} displayName={server.displayName} accessRole={server.accessRole} operationState={server.operationState} expectedUpdatedAt={server.updatedAt} deletionStatus={deletionStatus} />
                </ServerWorkspacePanel>
                <Suspense fallback={<><ServerWorkspacePanel section="Backups"><ManagedServerBackupsSkeleton /></ServerWorkspacePanel><ServerWorkspacePanel section="Save & config"><ManagedServerBackupsSkeleton /></ServerWorkspacePanel></>}>
                    <ManagedServerBackupsSection userId={userId} accessToken={accessToken} server={server} />
                </Suspense>
            </ManagedServerMaintenanceProvider>
        </ManagedServerPollingProvider>
    );
}

// Renders lifecycle controls with an accessible localized section name.
async function ManagedServerLifecycleSection({ server }: { server: MyServerSummary }) {
    const { t } = await getTranslations("managed-server");
    return (
        <section id="server-lifecycle" aria-label={t("page.serverControls")}>
                <ManagedServerControls
                    key={server.serverId}
                    serverId={server.serverId}
                    displayName={server.displayName}
                    accessRole={server.accessRole}
                    operationState={server.operationState}
                    observedGameState={server.observedGameState}
                    expectedUpdatedAt={server.updatedAt}
                    runtimeInsight={server.runtimeInsight}
                    subscriptionHold={server.subscriptionHold}
                    releaseChannel={server.releaseChannel}
                />
        </section>
    );
}

// Loads authorized backup and file state while keeping failures independent.
async function ManagedServerBackupsSection({
    userId,
    accessToken,
    server,
}: {
    userId: string;
    accessToken: string;
    server: MyServerSummary;
}) {
    const { t } = await getTranslations("managed-server");
    if (server.accessRole === "support" || server.accessRole === "admin") {
        return <ManagedServerFiles userId={userId} server={server} files={null} saves={null} backups={[]} status={null} />;
    }

    const savesRequest = listAllMyServerSaves(accessToken, server.serverId);
    // Earlier autosaves belong to the active campaign, so they are read once the save list names it.
    const autosavesRequest = savesRequest.then(async (saves) => {
        if (saves.activeSaveId === null) return null;
        const generations = await getMyServerSaveGenerations(accessToken, server.serverId, saves.activeSaveId);
        return {
            saveId: generations.saveId,
            campaignName: saves.items.find((save) => save.saveId === generations.saveId)?.displayName ?? null,
            items: generations.items,
        };
    });
    const [initialBackups, statusResult, filesResult, savesResult, autosavesResult] = await Promise.allSettled([
        listAllMyServerBackups(accessToken, server.serverId),
        readBackupStatus(accessToken, server.serverId),
        getMyServerFiles(accessToken, server.serverId),
        savesRequest,
        autosavesRequest,
    ]);
    let backupsResult = initialBackups;
    // Backup status retries inside its shared reader; history gets the same single retry here.
    if (backupsResult.status === "rejected" && !rateLimited(backupsResult.reason)) {
        await new Promise((resolve) => setTimeout(resolve, BACKUP_READ_RETRY_MILLISECONDS));
        [backupsResult] = await Promise.allSettled([listAllMyServerBackups(accessToken, server.serverId)]);
    }
    const backups = backupsResult.status === "fulfilled" ? backupsResult.value : [];
    const status = statusResult.status === "fulfilled" ? statusResult.value : null;
    const loadError = backupsResult.status === "rejected" || statusResult.status === "rejected"
        ? t("page.backupHistoryCouldnTBeLoadedJustNowBackupActionsArePaused")
        : undefined;
    if (backupsResult.status === "rejected") {
        console.error("Managed server backups failed to load");
    }
    if (statusResult.status === "rejected") {
        console.error("Managed server backup status failed to load");
    }
    // Autosave failures are reported on their own and never pause retained backups.
    if (autosavesResult.status === "rejected" && savesResult.status === "fulfilled") {
        console.error("Managed server autosaves failed to load");
    }

    return <ManagedServerFiles userId={userId} server={server}
        files={filesResult.status === "fulfilled" ? filesResult.value : null}
        saves={savesResult.status === "fulfilled" ? savesResult.value : null}
        backups={backups} status={status} loadError={loadError}
        autosaves={autosavesResult.status === "fulfilled" ? autosavesResult.value : null}
        autosaveLoadError={autosavesResult.status === "rejected" ? t("page.recentAutosavesCouldNotBeLoaded") : undefined} />;
}

// Renders the accessible loading state for streamed backup and file data.
async function ManagedServerBackupsSkeleton() {
    const { t } = await getTranslations("managed-server");
    return (
        <section className="rounded-lg border border-white/10 bg-surface p-5 sm:p-6" aria-busy="true" aria-label={t("page.loadingSavesConfigsAndBackups")}>
            <div className="h-3 w-28 animate-pulse bg-white/10" />
            <div className="mt-3 h-8 w-64 max-w-full animate-pulse bg-white/10" />
            <div className="mt-5 h-20 animate-pulse border border-white/10 bg-white/[0.02]" />
        </section>
    );
}

// Reads can fail briefly while the server restarts, so backup reads retry once before reporting anything.
// A rate-limited read is not retried: another request half a second later only extends the limit.
const BACKUP_READ_RETRY_MILLISECONDS = 500;

// The header status and the backups section both read backup status; one render reads it, and retries it, once.
const readBackupStatus = cache(async (accessToken: string, serverId: string) => {
    try {
        return await getMyServerBackupStatus(accessToken, serverId);
    } catch (error) {
        if (rateLimited(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, BACKUP_READ_RETRY_MILLISECONDS));
        return await getMyServerBackupStatus(accessToken, serverId);
    }
});

function rateLimited(error: unknown) {
    return error instanceof MyServersApiError && (error.code === "rate_limited" || error.code === "busy");
}

// Notices are optional page content: a failed read, a slow one or an older control plane never blocks the page.
function readServerNotices(accessToken: string, serverId: string) {
    return getMyServerNotices(accessToken, serverId, AbortSignal.timeout(5_000)).catch(() => null);
}

// The manager list is optional too: a failed read, or a control plane without it, still leaves the grant form.
function readServerManagers(accessToken: string, serverId: string) {
    return listServerManagers(accessToken, serverId, AbortSignal.timeout(5_000)).catch(() => null);
}

// A move status is optional page content too: any failure, including a control plane without the read, shows no move.
function readServerMoveStatus(accessToken: string, serverId: string) {
    return getMyServerMoveStatus(accessToken, serverId, AbortSignal.timeout(5_000)).catch(() => null);
}

function noticeBanner(serverId: string, notices: MyServerNotice[] | null) {
    return notices !== null && notices.length > 0 ? <ManagedServerNoticeBanner serverId={serverId} notices={notices} /> : undefined;
}

// The move status card follows a move that starts while the page is open, so it is always present above the notices.
function managedBanner(serverId: string, notices: MyServerNotice[] | null) {
    return <><ManagedServerMoveStatus notices={notices ?? []} />{noticeBanner(serverId, notices)}</>;
}

const ACTIVE_BACKUP_STATES = new Set(["queued", "running", "retry-wait"]);

// Lists the header status. A running-server backup stops the game inside the runner without changing the
// recorded lifecycle, so an active backup job is shown here rather than an unchanged "Running"; a move to
// another machine is likewise named rather than shown as a generic "Maintenance".
async function ManagedServerStatus({ accessToken, server, move, checkBackup }: { accessToken: string; server: MyServerSummary; move: MyServerMove | null; checkBackup: boolean }) {
    const { t } = await getTranslations("managed-server");
    let backup: "active" | "paused" | null = null;
    if (checkBackup && server.operationState === "running") {
        const job = (await readBackupStatus(accessToken, server.serverId).catch(() => null))?.job;
        if (job?.action === "backup" && ACTIVE_BACKUP_STATES.has(job.state)) backup = job.state === "running" ? "paused" : "active";
    }
    const entries = [
        [t("page.gameState"), backup === "paused" ? t("page.pausedForBackup") : formatManagedValue(server.observedGameState, t)],
        [t("page.lifecycle"), isMoveInProgress(move) ? t(move.state === "returning" ? "move.lifecycleReturning" : "move.lifecycleMoving")
            : backup !== null ? t("page.backingUp") : (isColdSleeping(server.operationState, server.runtimeInsight?.desiredState) && !server.subscriptionHold ? t("state.sleeping") : formatManagedValue(server.operationState, t))],
        [t("page.releaseChannel"), releaseChannelLabel(server.releaseChannel, { stable: t("page.releaseStable"), nightly: t("page.releaseNightly") })],
    ];
    const initializing = INITIALIZING_SERVER_STATES.has(server.operationState);
    return <div className="space-y-3">
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs" aria-label={t("page.serverStatus")}>
            {entries.map(([label, value]) => <div key={label} className="flex items-center gap-2"><dt className="text-foreground-muted">{label}</dt><dd className="font-medium text-foreground">{value}</dd></div>)}
        </dl>
        {initializing && <div role="status" aria-live="polite" className="flex max-w-2xl items-start gap-3 rounded-md border border-gold/30 bg-gold/[0.06] px-4 py-3 text-sm">
            <span aria-hidden="true" className="mt-0.5 size-3 shrink-0 animate-pulse rounded-full bg-gold motion-reduce:animate-none" />
            <div><p className="font-medium text-foreground">{t("page.serverInitializing")}</p><p className="mt-1 leading-6 text-foreground-muted">{t("page.serverInitializingDescription")}</p></div>
        </div>}
    </div>;
}

// Localizes known operational states while preserving the existing external-value display.
function formatManagedValue(value: string, t?: Translator["t"]) {
    const states = new Set(["running","stopped","starting","stopping","failed","degraded","unknown","provisioning","configuring","maintenance","updating","deletion-pending","deleting","deleted","suspended","awaiting-save","ready","offline","online"]);
    if (t && states.has(value)) return t(`state.${value}`);
    return value
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

// Renders a labeled server resource without altering its supplied value.
function ResourceCard({
    icon: Icon,
    label,
    value,
}: {
    icon: typeof Server;
    label: string;
    value: string;
}) {
    return (
        <div className="rounded-sm border border-white/10 bg-surface p-4 sm:p-5">
            <div className="flex items-center gap-2 text-foreground-muted">
                <Icon aria-hidden="true" className="size-4 text-gold-muted" />
                <p className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.14em]">{label}</p>
            </div>
            <p className="mt-2 break-words font-display text-xl font-semibold text-foreground sm:text-2xl">{value}</p>
        </div>
    );
}

// Delivers only the namespaces used by the managed server workspace.
export default async function ServerPage(props: ServerPageProps) {
    const content = await AuthorizedServerPage(props);
    const locale = await getLocale();
    const messages = await getMessages(["managed-server", "server-common", "cheats"], locale);
    return <LocalizationProvider locale={locale} messages={messages}>{content}</LocalizationProvider>;
}
