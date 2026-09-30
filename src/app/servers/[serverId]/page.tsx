import { releaseChannelLabel } from "@/app/lib/control-plane/presentation";
import { ServerSettingsPanel } from "@/app/components/servers/ServerSettingsPanel";
import { ServerSaveConfigPanels } from "@/app/components/servers/ServerSaveConfigPanels";
import { ServerManagementWorkspace, ServerWorkspacePanel, ServerConsoleWorkspace, UnavailableServerConsole, UnavailableServerPanel } from "@/app/components/servers/ServerManagementWorkspace";
import { ServerVisibilitySetting } from "@/app/components/servers/ServerVisibilitySetting";
import { connectionAddress } from "@/app/lib/hosting/connection-address";
import { ManagedServerFiles } from "@/app/components/servers/ManagedServerFiles";
import { getMyServerFiles } from "@/app/lib/hosting/server-files";
import { ManagedServerControls } from "@/app/components/servers/ManagedServerControls";
import { DownloadServerLogButton } from "@/app/components/servers/DownloadServerLogButton";
import { ManagedServerConsole } from "@/app/components/servers/ManagedServerConsole";
import { ManagedServerPollingProvider } from "@/app/components/servers/ManagedServerPollingProvider";
import { getMemberRole, hasHostedServerAccess } from "@/app/lib/auth/access";
import { hasServerFleetAccess } from "@/app/lib/auth/roles";
import type { MyServerSummary } from "@/app/lib/control-plane/types";
import {
    getMyServerBackupStatus,
    listAllMyServerBackups,
    listAllMyServers,
} from "@/app/lib/hosting/my-servers";
import { getServerForRole } from "@/app/lib/hosting/servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { CloudCog, Container, Database, HardDrive, MemoryStick, Server } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

type ServerPageProps = {
    params: Promise<{ serverId: string }>;
};

const managedAccessLabels: Record<MyServerSummary["accessRole"], string> = {
    admin: "Read-only administrator",
    manager: "Manager",
    owner: "Owner",
    support: "Read-only support",
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Manage Server",
    description: "Manage a Bannerlord Coop server."
};

// Authorizes the requested server before resolving its available management capabilities.
export default async function ServerPage({ params }: ServerPageProps) {
    const { serverId } = await params;
    const supabase = await getSupabaseServerClient();
    const [{ data: userData }, { data: sessionData }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.auth.getSession(),
    ]);
    const user = userData.user;

    if (!user) redirect(`/login?next=/servers/${encodeURIComponent(serverId)}`);

    const accessToken = sessionData.session?.access_token ?? null;
    if (accessToken === null) redirect(`/login?next=/servers/${encodeURIComponent(serverId)}`);

    let managedServer: MyServerSummary | null = null;
    try {
        managedServer = (await listAllMyServers(accessToken))
            .find((server) => server.serverId === serverId) ?? null;
    } catch (error) {
        console.error("Managed server detail failed to load", error);
    }

    if (managedServer !== null) {
        return <ManagedServerManagementPage userId={user.id} accessToken={accessToken} server={managedServer} />;
    }

    if (!hasHostedServerAccess(user)) redirect("/servers");

    const role = getMemberRole(user);
    const server = getServerForRole(serverId, role);
    if (!server) redirect("/servers");

    return <ServerManagementWorkspace
        name={<h1 id="server-heading" className="font-display text-2xl font-semibold sm:text-4xl">{server.name}</h1>}
        summary={<>{server.plan} · {server.location} · Preview</>}
        notice="Preview server. The control plane is not connected; server actions are unavailable."
    >
        <ServerWorkspacePanel section="Console"><ServerConsoleWorkspace><UnavailableServerConsole /></ServerConsoleWorkspace></ServerWorkspacePanel>
        <UnavailableFileWorkspaces />
        <ServerWorkspacePanel section="Settings">
            <ServerSettingsPanel name={server.name} />
            <section className="grid gap-3 sm:grid-cols-3" aria-label="Server information">
                <ResourceCard icon={MemoryStick} label="Memory" value={server.memory} />
                <ResourceCard icon={HardDrive} label="Storage" value={server.storage} />
                <ResourceCard icon={Server} label="Version" value={server.version} />
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

// Keeps fictional preview file and backup controls non-operational.
function UnavailableFileWorkspaces() {
    return <>
        <ServerWorkspacePanel section="Backups"><UnavailableServerPanel title="Backups" actions={["Create backup", "Restore backup"]} /></ServerWorkspacePanel>
        <ServerWorkspacePanel section="Save & config">
            <ServerSaveConfigPanels />
        </ServerWorkspacePanel>
    </>;
}

// Presents the authenticated managed server and its authorized settings.
function ManagedServerManagementPage({ userId, accessToken, server }: {
    userId: string; accessToken: string; server: MyServerSummary;
}) {
    return <ServerManagementWorkspace
        name={<h1 id="server-heading" className="font-display text-2xl font-semibold sm:text-4xl">{server.displayName}</h1>}
        address={connectionAddress(server.connectionIp ?? null, server.gamePorts ?? [])}
        visibility={<ServerVisibilitySetting serverId={server.serverId} visibility={server.visibility} accessRole={server.accessRole} expectedUpdatedAt={server.updatedAt} />}
        summary={<>{formatManagedValue(server.observedGameState)} · {formatManagedValue(server.friendlyRegion)} · {managedAccessLabels[server.accessRole]}</>}
        status={<section className="grid gap-3 sm:grid-cols-3" aria-label="Server status">
            <ResourceCard icon={Container} label="Game state" value={formatManagedValue(server.observedGameState)} />
            <ResourceCard icon={CloudCog} label="Lifecycle" value={formatManagedValue(server.operationState)} />
            <ResourceCard icon={Database} label="Release channel" value={releaseChannelLabel(server.releaseChannel)} />
        </section>}
    >
        <ManagedServerSections userId={userId} accessToken={accessToken} server={server} />
        <ServerWorkspacePanel section="Settings">
            <ServerSettingsPanel releaseAccess={{ serverId: server.serverId, channel: server.releaseChannel, expectedUpdatedAt: server.updatedAt, canEdit: server.accessRole === "owner" }} name={server.displayName} visibility={server.visibility ?? "private"} visibilityAccess={{ serverId: server.serverId, expectedUpdatedAt: server.updatedAt, canEdit: server.accessRole === "owner" }} />
        </ServerWorkspacePanel>
    </ServerManagementWorkspace>;
}

// Renders managed controls and output using the authorized control-plane server identity.
function ManagedServerSections({
    userId,
    accessToken,
    server,
}: {
    userId: string;
    accessToken: string;
    server: MyServerSummary;
}) {
    return (
        <ManagedServerPollingProvider>
            <ServerWorkspacePanel section="Console">
                <ServerConsoleWorkspace>
                    {server.accessRole === "owner" || server.accessRole === "manager" ? <>
                        <ManagedServerLifecycleSection server={server} />
                        <ManagedServerConsole serverId={server.serverId} />
                        <DownloadServerLogButton serverId={server.serverId} userId={userId} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-3 py-2 text-sm" />
                    </> : <UnavailableServerConsole controls={<ManagedServerLifecycleSection server={server} />} logDownload={{ serverId: server.serverId, userId }} />}
                </ServerConsoleWorkspace>
            </ServerWorkspacePanel>
            <Suspense fallback={<><ServerWorkspacePanel section="Backups"><ManagedServerBackupsSkeleton /></ServerWorkspacePanel><ServerWorkspacePanel section="Save & config"><ManagedServerBackupsSkeleton /></ServerWorkspacePanel></>}>
                <ManagedServerBackupsSection userId={userId} accessToken={accessToken} server={server} />
            </Suspense>
        </ManagedServerPollingProvider>
    );
}

// Connects lifecycle controls to the authorized managed server.
function ManagedServerLifecycleSection({ server }: { server: MyServerSummary }) {
    return (
        <section id="server-lifecycle" aria-label="Server controls">
                <ManagedServerControls
                    serverId={server.serverId}
                    displayName={server.displayName}
                    accessRole={server.accessRole}
                    operationState={server.operationState}
                    expectedUpdatedAt={server.updatedAt}
                />
        </section>
    );
}

// Loads managed backup and file data only for owners and managers.
async function ManagedServerBackupsSection({
    userId,
    accessToken,
    server,
}: {
    userId: string;
    accessToken: string;
    server: MyServerSummary;
}) {
    if (server.accessRole === "support" || server.accessRole === "admin") {
        return <ManagedServerFiles userId={userId} server={server} files={null} backups={[]} status={null} />;
    }

    const [backupsResult, statusResult, filesResult] = await Promise.allSettled([
        listAllMyServerBackups(accessToken, server.serverId),
        getMyServerBackupStatus(accessToken, server.serverId),
        getMyServerFiles(accessToken, server.serverId),
    ]);
    const backups = backupsResult.status === "fulfilled" ? backupsResult.value : [];
    const status = statusResult.status === "fulfilled" ? statusResult.value : null;
    const loadError = backupsResult.status === "rejected" || statusResult.status === "rejected"
        ? "Backup history or durable progress could not be loaded. Refresh before submitting another backup operation."
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

// Displays pending managed backup and file content.
function ManagedServerBackupsSkeleton() {
    return (
        <section className="rounded-lg border border-white/10 bg-surface p-5 sm:p-6" aria-busy="true" aria-label="Loading saves, configs and backups">
            <div className="h-3 w-28 animate-pulse bg-white/10" />
            <div className="mt-3 h-8 w-64 max-w-full animate-pulse bg-white/10" />
            <div className="mt-5 h-20 animate-pulse border border-white/10 bg-white/[0.02]" />
        </section>
    );
}

// Formats control-plane state identifiers for display.
function formatManagedValue(value: string) {
    return value
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

// Displays one server resource or state value.
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
