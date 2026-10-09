import type { Translator } from "@/app/lib/localization/types";
import { LocalizationProvider } from "@/app/lib/localization/client";
import { hostingRegionLabel } from "../../../../supabase/functions/_shared/hosting-regions";
import { getLocale, getMessages, getTranslations } from "@/app/lib/localization/server";
import { ManagedServerCommands } from "@/app/components/servers/ManagedServerCommands";
import { releaseChannelLabel } from "@/app/lib/control-plane/presentation";
import { ServerSettingsPanel } from "@/app/components/servers/ServerSettingsPanel";
import { ServerSaveConfigPanels } from "@/app/components/servers/ServerSaveConfigPanels";
import { EditableServerName } from "@/app/components/servers/EditableServerName";
import { ServerManagementWorkspace, ServerWorkspacePanel, ServerConsoleWorkspace, UnavailableServerConsole, UnavailableServerPanel } from "@/app/components/servers/ServerManagementWorkspace";
import { ServerVisibilitySetting } from "@/app/components/servers/ServerVisibilitySetting";
import { serverWorkspaceSectionFromTab, type ServerWorkspaceSection } from "@/app/components/servers/server-workspace-tabs";
import { LiveServerVisibilitySetup } from "@/app/components/servers/LiveServerVisibilitySetup";
import { connectionAddress } from "@/app/lib/hosting/connection-address";
import { LiveServerAccessManager } from "@/app/components/servers/LiveServerAccessManager";
import { LiveServerConsole } from "@/app/components/servers/LiveServerConsole";
import { LiveServerBackupSetup, type LiveServerBackupUnavailableReason } from "@/app/components/servers/LiveServerBackupSetup";
import { LiveServerFileSetup } from "@/app/components/servers/LiveServerFileSetup";
import { ManagedServerFiles } from "@/app/components/servers/ManagedServerFiles";
import { getMyServerFiles } from "@/app/lib/hosting/server-files";
import { ManagedServerControls, ManagedServerPassword } from "@/app/components/servers/ManagedServerControls";
import { ManagedServerPollingProvider } from "@/app/components/servers/ManagedServerPollingProvider";
import { ManagedServerDelete } from "@/app/components/servers/ManagedServerDelete";
import { readManagedServerStatusFingerprint } from "@/app/servers/managed-server-actions";
import {
    getLiveConsoleAccessLevel,
    getMemberRole,
    hasHostedServerAccess,
} from "@/app/lib/auth/access";
import {
    getLiveConsoleMember,
    getOperatedLiveConsoleServerIds,
    getOwnedLiveConsoleServerIds,
    type LiveConsoleAccessLevel,
    type LiveConsoleMember,
} from "@/app/lib/console/access";
import {
    getConsoleGatewayUrl,
    getLiveConsoleServer,
    type LiveConsoleServer,
} from "@/app/lib/console/servers";
import { hasServerFleetAccess } from "@/app/lib/auth/roles";
import type { MyServerSummary } from "@/app/lib/control-plane/types";
import {
    getMyServerBackupStatus,
    listAllMyServerBackups,
    type MyServerDeletionStatus,
} from "@/app/lib/hosting/my-servers";
import { getMyServerDeletionStatus, listAllMyServers } from "@/app/lib/hosting/my-servers-server";
import { getServerDisplayNames } from "@/app/lib/hosting/server-settings";
import { getServerForRole } from "@/app/lib/hosting/servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { listSupabaseUsers } from "@/app/lib/supabase/users";
import { Container, HardDrive, MemoryStick, Server } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

type ServerPageProps = {
    params: Promise<{ serverId: string }>;
    searchParams: Promise<{
        accessError?: string | string[];
        accessUpdated?: string | string[];
        tab?: string | string[];
    }>;
};

// Selects the first existing query value without altering external feedback.
function firstValue(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
}

export const dynamic = "force-dynamic";

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

    const liveServer = getLiveConsoleServer(serverId);
    const liveAccessLevel = liveServer ? getLiveConsoleAccessLevel(user, liveServer.id) : null;
    if (liveServer && !liveAccessLevel) redirect("/servers");

    let managedServer: MyServerSummary | null = null;
    let managedLookupFailed = false;
    try {
        const managedServerId = liveServer?.managedServerId ?? serverId;
        managedServer = (await listAllMyServers(accessToken))
            .find((server) => server.serverId === managedServerId) ?? null;
    } catch (error) {
        managedLookupFailed = true;
        console.error("Managed server detail failed to load", error);
    }

    if (liveServer && liveAccessLevel) {
        const displayNames = await getServerDisplayNames([liveServer.id]);
        return (
            <LiveServerManagementPage
                accessError={firstValue(query.accessError)}
                accessLevel={liveAccessLevel}
                accessToken={accessToken}
                accessUpdated={firstValue(query.accessUpdated)}
                rememberedSection={rememberedSection}
                userId={user.id}
                managedServer={managedServer}
                backupUnavailableReason={managedLookupFailed ? "lookup-failed" : liveServer.managedServerId ? "access-required" : "mapping-required"}
                logDownload={managedServer && (managedServer.accessRole === "owner" || managedServer.accessRole === "manager")
                    ? { serverId: managedServer.serverId, userId: user.id } : undefined}
                server={{
                    ...liveServer,
                    name: managedServer?.displayName ?? displayNames.get(liveServer.id) ?? liveServer.name,
                }}
            />
        );
    }

    if (managedServer !== null) {
        return <ManagedServerManagementPage userId={user.id} accessToken={accessToken} server={managedServer} initialSection={rememberedSection} />;
    }

    if (!hasHostedServerAccess(user)) redirect("/");

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
    </>;
}

/** Composes the managed workspace with compact runtime metadata and task-specific panels. */
async function ManagedServerManagementPage({ userId, accessToken, server, initialSection }: {
    userId: string; accessToken: string; server: MyServerSummary; initialSection?: ServerWorkspaceSection;
}) {
    const { t } = await getTranslations("managed-server");
    const deletionStatus = server.accessRole === "owner"
        ? await getMyServerDeletionStatus(accessToken, server.serverId, AbortSignal.timeout(5_000)).catch(() => null)
        : null;
    const managedAccessLabels: Record<MyServerSummary["accessRole"], string> = {
        admin: t("page.readOnlyAdministrator"),
        manager: t("page.manager"),
        owner: t("page.owner"),
        support: t("page.readOnlySupport"),
    };

    return <ServerManagementWorkspace
        name={<h1 id="server-heading" className="font-display text-2xl font-semibold sm:text-4xl">{server.displayName}</h1>}
        initialSection={initialSection}
        address={connectionAddress(server.connectionIp ?? null, server.gamePorts ?? [])}
        visibility={<ServerVisibilitySetting serverId={server.serverId} visibility={server.visibility} accessRole={server.accessRole} expectedUpdatedAt={server.updatedAt} />}
        summary={t("page.managedSummary", { region: hostingRegionLabel(server.friendlyRegion), access: managedAccessLabels[server.accessRole] })}
        status={<Suspense fallback={<ManagedServerStatus accessToken={accessToken} server={server} checkBackup={false} />}>
            <ManagedServerStatus accessToken={accessToken} server={server} checkBackup={server.accessRole === "owner" || server.accessRole === "manager"} />
        </Suspense>}
    >
        <ManagedServerSections userId={userId} accessToken={accessToken} server={server} deletionStatus={deletionStatus} />
        <ServerWorkspacePanel section="Settings">
            <ServerSettingsPanel settingsAccess={{ serverId: server.serverId, maintenanceSlot: server.maintenanceSlot, timezone: server.timezone, expectedUpdatedAt: server.updatedAt, canEdit: server.accessRole === "owner" }} releaseAccess={{ serverId: server.serverId, channel: server.releaseChannel, expectedUpdatedAt: server.updatedAt, canEdit: server.accessRole === "owner" }} name={server.displayName} visibility={server.visibility ?? "private"} visibilityAccess={{ serverId: server.serverId, expectedUpdatedAt: server.updatedAt, canEdit: server.accessRole === "owner" }} />
        </ServerWorkspacePanel>
    </ServerManagementWorkspace>;
}

// Keeps managed controls and output in the console workspace without duplicating an existing live console.
function ManagedServerSections({
    userId,
    accessToken,
    server,
    hasLiveConsole = false,
    deletionStatus,
}: {
    userId: string;
    accessToken: string;
    server: MyServerSummary;
    hasLiveConsole?: boolean;
    deletionStatus?: MyServerDeletionStatus | null;
}) {
    return (
        <ManagedServerPollingProvider readStatus={readManagedServerStatusFingerprint}>
            <ServerWorkspacePanel section="Console">
                {hasLiveConsole ? <ManagedServerLifecycleSection server={server} /> : server.accessRole === "owner" || server.accessRole === "manager"
                    ? <ManagedServerCommands key={`${userId}:${server.serverId}`} server={server} userId={userId} controls={<ManagedServerLifecycleSection server={server} />} />
                    : <ServerConsoleWorkspace><UnavailableServerConsole controls={<ManagedServerLifecycleSection server={server} />} logDownload={{ serverId: server.serverId, userId }} /></ServerConsoleWorkspace>}
            </ServerWorkspacePanel>
            <ServerWorkspacePanel section="Settings">
                <ManagedServerPassword serverId={server.serverId} accessRole={server.accessRole} operationState={server.operationState} expectedUpdatedAt={server.updatedAt} />
                <ManagedServerDelete key={`${userId}:${server.serverId}`} serverId={server.serverId} displayName={server.displayName} accessRole={server.accessRole} operationState={server.operationState} expectedUpdatedAt={server.updatedAt} deletionStatus={deletionStatus} />
            </ServerWorkspacePanel>
            <Suspense fallback={<><ServerWorkspacePanel section="Backups"><ManagedServerBackupsSkeleton /></ServerWorkspacePanel><ServerWorkspacePanel section="Save & config"><ManagedServerBackupsSkeleton /></ServerWorkspacePanel></>}>
                <ManagedServerBackupsSection userId={userId} accessToken={accessToken} server={server} />
            </Suspense>
        </ManagedServerPollingProvider>
    );
}

// Renders lifecycle controls with an accessible localized section name.
async function ManagedServerLifecycleSection({ server }: { server: MyServerSummary }) {
    const { t } = await getTranslations("managed-server");
    return (
        <section id="server-lifecycle" aria-label={t("page.serverControls")}>
                <ManagedServerControls
                    serverId={server.serverId}
                    displayName={server.displayName}
                    accessRole={server.accessRole}
                    operationState={server.operationState}
                    observedGameState={server.observedGameState}
                    expectedUpdatedAt={server.updatedAt}
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
        return <ManagedServerFiles userId={userId} server={server} files={null} backups={[]} status={null} />;
    }

    const [initialBackups, initialStatus, filesResult] = await Promise.allSettled([
        listAllMyServerBackups(accessToken, server.serverId),
        getMyServerBackupStatus(accessToken, server.serverId),
        getMyServerFiles(accessToken, server.serverId),
    ]);
    let backupsResult = initialBackups;
    let statusResult = initialStatus;
    // Reads can fail briefly while the server restarts; retry once before reporting anything.
    if (backupsResult.status === "rejected" || statusResult.status === "rejected") {
        await new Promise((resolve) => setTimeout(resolve, 500));
        [backupsResult, statusResult] = await Promise.allSettled([
            backupsResult.status === "rejected" ? listAllMyServerBackups(accessToken, server.serverId) : Promise.resolve(backupsResult.value),
            statusResult.status === "rejected" ? getMyServerBackupStatus(accessToken, server.serverId) : Promise.resolve(statusResult.value),
        ]);
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

    return <ManagedServerFiles userId={userId} server={server}
        files={filesResult.status === "fulfilled" ? filesResult.value : null}
        backups={backups} status={status} loadError={loadError} />;
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

// Renders authorized live controls with independently authorized managed log downloads.
async function LiveServerManagementPage({
    userId,
    accessError,
    accessLevel,
    accessToken,
    accessUpdated,
    rememberedSection,
    managedServer,
    backupUnavailableReason,
    logDownload,
    server,
}: {
    userId: string;
    accessError?: string;
    accessLevel: LiveConsoleAccessLevel;
    accessToken: string;
    accessUpdated?: string;
    rememberedSection?: ServerWorkspaceSection;
    managedServer: MyServerSummary | null;
    backupUnavailableReason: LiveServerBackupUnavailableReason;
    logDownload?: { serverId: string; userId: string };
    server: LiveConsoleServer;
}) {
    const { t } = await getTranslations("managed-server");
    const accessLabels: Record<LiveConsoleAccessLevel, string> = {
        admin: t("page.administrator"),
        owner: t("page.owner"),
        operator: t("page.operator"),
    };

    const memberLabels = { missingName: t("member.missingName"), missingEmail: t("member.missingEmail") };
    const canManageAssignments = accessLevel === "admin" || accessLevel === "owner";
    let assignmentLoadError = "";
    let assignmentWarning = "";
    let operators: LiveConsoleMember[] = [];
    let owner: LiveConsoleMember | null = null;

    if (canManageAssignments) {
        try {
            const result = await listSupabaseUsers();
            if (result.truncated) {
                assignmentLoadError = t("page.directoryTooLarge");
            } else {
                const owners = result.users.filter((member) =>
                    getOwnedLiveConsoleServerIds(member.app_metadata).includes(server.id),
                );
                const operatorUsers = result.users.filter((member) =>
                    getOperatedLiveConsoleServerIds(member.app_metadata).includes(server.id),
                );

                owner = owners[0] ? getLiveConsoleMember(owners[0], memberLabels) : null;
                operators = operatorUsers.map((member) => getLiveConsoleMember(member, memberLabels));
                if (owners.length > 1) {
                    assignmentWarning = t("page.multipleOwners");
                }
            }
        } catch (error) {
            console.error("Live server assignments failed to load", error);
            assignmentLoadError = t("page.assignmentsUnavailable");
        }
    }

    const deletionStatus = managedServer?.accessRole === "owner"
        ? await getMyServerDeletionStatus(accessToken, managedServer.serverId, AbortSignal.timeout(5_000)).catch(() => null)
        : null;

    return <ServerManagementWorkspace
        name={<EditableServerName key={server.name} canEdit={canManageAssignments && managedServer === null} initialName={server.name} serverId={server.id} />}
        address={server.address}
        visibility={managedServer !== null
            ? <ServerVisibilitySetting serverId={managedServer.serverId} visibility={managedServer.visibility} accessRole={managedServer.accessRole} expectedUpdatedAt={managedServer.updatedAt} />
            : <a href="#server-visibility" className="ml-auto inline-flex min-h-10 items-center rounded-md border border-white/15 px-3 text-sm text-gold underline focus-visible:outline-2 focus-visible:outline-gold">{t("page.setUpVisibility")}</a>}
        summary={t("page.liveSummary", { provider: server.provider, access: accessLabels[accessLevel] })}
        initialSection={accessError || accessUpdated ? "Settings" : rememberedSection ?? "Console"}
        notice={t("page.protectedProductionAccessControlsAndCommandsAffectTheLiveBannerlordProcessImmediately")}
    >
        <ServerWorkspacePanel section="Console">
            <LiveServerConsole gatewayUrl={getConsoleGatewayUrl()} serverId={server.id} logDownload={logDownload} />
            {!logDownload && <p className="text-sm text-foreground-muted">{t("page.logDownloadsRequireALinkedManagedServerAndOwnerOrManagerAccess")}</p>}
        </ServerWorkspacePanel>
        {managedServer !== null
            ? <ManagedServerSections userId={userId} accessToken={accessToken} server={managedServer} hasLiveConsole deletionStatus={deletionStatus} />
            : <>
                <ServerWorkspacePanel section="Backups"><LiveServerBackupSetup reason={backupUnavailableReason} serverId={server.id} /></ServerWorkspacePanel>
                <ServerWorkspacePanel section="Save & config"><LiveServerFileSetup reason={backupUnavailableReason} serverId={server.id} /></ServerWorkspacePanel>
            </>}
        <ServerWorkspacePanel section="Settings">
            <ServerSettingsPanel settingsAccess={managedServer ? { serverId: managedServer.serverId, maintenanceSlot: managedServer.maintenanceSlot, timezone: managedServer.timezone, expectedUpdatedAt: managedServer.updatedAt, canEdit: managedServer.accessRole === "owner" } : undefined} releaseAccess={managedServer ? { serverId: managedServer.serverId, channel: managedServer.releaseChannel, expectedUpdatedAt: managedServer.updatedAt, canEdit: managedServer.accessRole === "owner" } : undefined} name={server.name} renameServerId={canManageAssignments && managedServer === null ? server.id : undefined} visibility={managedServer ? managedServer.visibility ?? "private" : undefined} visibilityAccess={managedServer ? { serverId: managedServer.serverId, expectedUpdatedAt: managedServer.updatedAt, canEdit: managedServer.accessRole === "owner" } : undefined} />
            {managedServer === null && <LiveServerVisibilitySetup reason={backupUnavailableReason} serverId={server.id} />}
            <section className="grid gap-3 sm:grid-cols-2" aria-label={t("page.serverInformation")}>
                <ResourceCard icon={Server} label={t("page.provider")} value={server.provider} />
                <ResourceCard icon={Container} label={t("page.node")} value={server.nodeId} />
            </section>
            {canManageAssignments && (
                    <section id="server-access" className="rounded-lg border border-white/10 bg-surface p-5 sm:p-6" aria-labelledby="server-access-heading">
                        <h2 id="server-access-heading" className="text-base font-semibold text-foreground">
                            {t("page.serverAccess")}</h2>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-foreground-muted">
                            {t("page.administratorsAssignTheOwnerAdministratorsAndTheOwnerCanGrantOperatorAccess")}</p>

                        {accessError && (
                            <p role="alert" className="mt-4 border-l-2 border-crimson bg-crimson/10 px-4 py-3 text-sm text-red-200">
                                {accessError}
                            </p>
                        )}
                        {accessUpdated && !accessError && (
                            <p role="status" className="mt-4 border-l-2 border-emerald-500 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                                {accessUpdated}
                            </p>
                        )}

                        <LiveServerAccessManager
                            canAssignOwner={accessLevel === "admin"}
                            loadError={assignmentLoadError || undefined}
                            operators={operators}
                            owner={owner}
                            serverId={server.id}
                            warning={assignmentWarning || undefined}
                        />
                    </section>
                )}
        </ServerWorkspacePanel>
    </ServerManagementWorkspace>;
}

const ACTIVE_BACKUP_STATES = new Set(["queued", "running", "retry-wait"]);

// Lists the header status. A running-server backup stops the game inside the runner without changing the
// recorded lifecycle, so an active backup job is shown here rather than an unchanged "Running".
async function ManagedServerStatus({ accessToken, server, checkBackup }: { accessToken: string; server: MyServerSummary; checkBackup: boolean }) {
    const { t } = await getTranslations("managed-server");
    let backup: "active" | "paused" | null = null;
    if (checkBackup && server.operationState === "running") {
        const job = (await getMyServerBackupStatus(accessToken, server.serverId).catch(() => null))?.job;
        if (job?.action === "backup" && ACTIVE_BACKUP_STATES.has(job.state)) backup = job.state === "running" ? "paused" : "active";
    }
    const entries = [
        [t("page.gameState"), backup === "paused" ? t("page.pausedForBackup") : formatManagedValue(server.observedGameState, t)],
        [t("page.lifecycle"), backup !== null ? t("page.backingUp") : formatManagedValue(server.operationState, t)],
        [t("page.releaseChannel"), releaseChannelLabel(server.releaseChannel, { stable: t("page.releaseStable"), nightly: t("page.releaseNightly") })],
    ];
    return <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs" aria-label={t("page.serverStatus")}>
        {entries.map(([label, value]) => <div key={label} className="flex items-center gap-2"><dt className="text-foreground-muted">{label}</dt><dd className="font-medium text-foreground">{value}</dd></div>)}
    </dl>;
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

// Delivers only the namespaces used by the unified managed and live workspace.
export default async function ServerPage(props: ServerPageProps) {
    const content = await AuthorizedServerPage(props);
    const locale = await getLocale();
    const messages = await getMessages(["managed-server", "server-common", "live-server", "cheats"], locale);
    return <LocalizationProvider locale={locale} messages={messages}>{content}</LocalizationProvider>;
}
