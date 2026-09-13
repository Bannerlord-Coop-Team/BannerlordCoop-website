import { EditableServerName } from "@/app/components/servers/EditableServerName";
import { ServerManagementWorkspace, ServerWorkspacePanel, ServerConsoleWorkspace, UnavailableServerPanel } from "@/app/components/servers/ServerManagementWorkspace";
import { ServerVisibilitySetting } from "@/app/components/servers/ServerVisibilitySetting";
import { connectionAddress } from "@/app/lib/hosting/connection-address";
import { LiveServerAccessManager } from "@/app/components/servers/LiveServerAccessManager";
import { LiveServerConsole } from "@/app/components/servers/LiveServerConsole";
import { ManagedServerFiles } from "@/app/components/servers/ManagedServerFiles";
import { getMyServerFiles } from "@/app/lib/hosting/server-files";
import { ManagedServerControls } from "@/app/components/servers/ManagedServerControls";
import { ManagedServerPollingProvider } from "@/app/components/servers/ManagedServerPollingProvider";
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
    listAllMyServers,
} from "@/app/lib/hosting/my-servers";
import { getServerDisplayNames } from "@/app/lib/hosting/server-settings";
import { getServerForRole } from "@/app/lib/hosting/servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { listSupabaseUsers } from "@/app/lib/supabase/users";
import { CloudCog, Container, Database, HardDrive, MemoryStick, Server } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

type ServerPageProps = {
    params: Promise<{ serverId: string }>;
    searchParams: Promise<{
        accessError?: string | string[];
        accessUpdated?: string | string[];
    }>;
};

const accessLabels: Record<LiveConsoleAccessLevel, string> = {
    admin: "Administrator",
    owner: "Owner",
    operator: "Operator",
};

const managedAccessLabels: Record<MyServerSummary["accessRole"], string> = {
    admin: "Read-only administrator",
    manager: "Manager",
    owner: "Owner",
    support: "Read-only support",
};

function firstValue(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
}

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Manage Server",
    description: "Manage a Bannerlord Coop server."
};

export default async function ServerPage({ params, searchParams }: ServerPageProps) {
    const [{ serverId }, query] = await Promise.all([params, searchParams]);
    const liveServer = getLiveConsoleServer(serverId);
    const supabase = await getSupabaseServerClient();
    const [{ data: userData }, { data: sessionData }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.auth.getSession(),
    ]);
    const user = userData.user;

    if (!user) redirect(`/login?next=/servers/${encodeURIComponent(serverId)}`);

    let managedServer: MyServerSummary | null = null;
    const accessToken = sessionData.session?.access_token ?? null;
    if (accessToken !== null) {
        try {
            managedServer = (await listAllMyServers(accessToken))
                .find((server) => server.serverId === serverId) ?? null;
        } catch (error) {
            console.error("Managed server detail failed to load", error);
        }
    }

    if (liveServer) {
        const accessLevel = getLiveConsoleAccessLevel(user, liveServer.id);
        if (accessLevel) {
            const displayNames = await getServerDisplayNames([liveServer.id]);
            return (
                <LiveServerManagementPage
                    accessError={firstValue(query.accessError)}
                    accessLevel={accessLevel}
                    accessToken={accessToken}
                    accessUpdated={firstValue(query.accessUpdated)}
                    userId={user.id}
                    managedServer={managedServer}
                    server={{
                        ...liveServer,
                        name: displayNames.get(liveServer.id) ?? liveServer.name,
                    }}
                />
            );
        }
    }

    if (managedServer !== null && accessToken !== null) {
        return <ManagedServerManagementPage userId={user.id} accessToken={accessToken} server={managedServer} />;
    }

    if (!hasHostedServerAccess(user)) redirect("/");

    const role = getMemberRole(user);
    const server = getServerForRole(serverId, role);
    if (!server) redirect("/servers");

    return <ServerManagementWorkspace
        name={<h1 id="server-heading" className="font-display text-2xl font-semibold sm:text-4xl">{server.name}</h1>}
        summary={<>{server.plan} · {server.location} · Preview</>}
        notice="Preview server. The control plane is not connected; server actions are unavailable."
    >
        <ServerWorkspacePanel section="Console"><ServerConsoleWorkspace><UnavailableServerPanel title="Console" actions={["Start", "Stop", "Restart", "Send command"]} /></ServerConsoleWorkspace></ServerWorkspacePanel>
        <UnavailableFileWorkspaces />
        <ServerWorkspacePanel section="Settings">
            <UnavailableServerPanel title="Server settings" actions={["Edit name", "Private", "Public"]} />
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

function UnavailableFileWorkspaces() {
    return <>
        <ServerWorkspacePanel section="Backups"><UnavailableServerPanel title="Backups" actions={["Create backup", "Restore backup"]} /></ServerWorkspacePanel>
        <ServerWorkspacePanel section="Save & config">
            <UnavailableServerPanel title="Campaign save" actions={["Import save", "Export save"]} />
            <UnavailableServerPanel title="Configuration" actions={["Import config", "Export config", "Save config"]} />
        </ServerWorkspacePanel>
    </>;
}

function ManagedServerManagementPage({ userId, accessToken, server }: {
    userId: string; accessToken: string; server: MyServerSummary;
}) {
    return <ServerManagementWorkspace
        name={<h1 id="server-heading" className="font-display text-2xl font-semibold sm:text-4xl">{server.displayName}</h1>}
        address={connectionAddress(server.connectionIp ?? null, server.gamePorts ?? [])}
        summary={<>{formatManagedValue(server.observedGameState)} · {formatManagedValue(server.friendlyRegion)} · {managedAccessLabels[server.accessRole]}</>}
        notice="Connected to the control plane. Disruptive operations require confirmation and may wait for backups or other durable work to finish."
    >
        <ManagedServerSections userId={userId} accessToken={accessToken} server={server} />
        <ServerWorkspacePanel section="Settings">
            <ServerVisibilitySetting serverId={server.serverId} visibility={server.visibility} accessRole={server.accessRole} expectedUpdatedAt={server.updatedAt} />
            <section className="grid gap-3 sm:grid-cols-3" aria-label="Server status">
                <ResourceCard icon={Container} label="Game state" value={formatManagedValue(server.observedGameState)} />
                <ResourceCard icon={CloudCog} label="Lifecycle" value={formatManagedValue(server.operationState)} />
                <ResourceCard icon={Database} label="Release channel" value={formatManagedValue(server.releaseChannel)} />
            </section>
            <UnavailableServerPanel title="Server name" actions={["Edit name"]} />
        </ServerWorkspacePanel>
    </ServerManagementWorkspace>;
}

function ManagedServerSections({
    userId,
    accessToken,
    server,
    hasLiveConsole = false,
}: {
    userId: string;
    accessToken: string;
    server: MyServerSummary;
    hasLiveConsole?: boolean;
}) {
    return (
        <ManagedServerPollingProvider>
            <ServerWorkspacePanel section="Console">
                {hasLiveConsole ? <ManagedServerLifecycleSection server={server} /> : <ServerConsoleWorkspace>
                    <ManagedServerLifecycleSection server={server} />
                    <UnavailableServerPanel title="Console output" actions={["Send command", "Download logs"]} />
                </ServerConsoleWorkspace>}
            </ServerWorkspacePanel>
            <Suspense fallback={<><ServerWorkspacePanel section="Backups"><ManagedServerBackupsSkeleton /></ServerWorkspacePanel><ServerWorkspacePanel section="Save & config"><ManagedServerBackupsSkeleton /></ServerWorkspacePanel></>}>
                <ManagedServerBackupsSection userId={userId} accessToken={accessToken} server={server} />
            </Suspense>
        </ManagedServerPollingProvider>
    );
}

function ManagedServerLifecycleSection({ server }: { server: MyServerSummary }) {
    return (
        <section id="server-lifecycle" className="rounded-lg border border-white/10 bg-surface p-5 sm:p-6" aria-labelledby="server-lifecycle-heading">
            <p className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-gold">
                Lifecycle
            </p>
            <h2 id="server-lifecycle-heading" className="mt-2 font-display text-2xl font-semibold text-foreground sm:text-3xl">
                Server controls
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-foreground-muted">
                Current state: <strong className="font-semibold text-foreground">{formatManagedValue(server.operationState)}</strong>.
                Disruptive operations require confirmation and may wait for backups or other durable work to finish.
            </p>
            <div className="mt-5">
                <ManagedServerControls
                    serverId={server.serverId}
                    displayName={server.displayName}
                    accessRole={server.accessRole}
                    operationState={server.operationState}
                    expectedUpdatedAt={server.updatedAt}
                />
            </div>
        </section>
    );
}

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

function ManagedServerBackupsSkeleton() {
    return (
        <section className="rounded-lg border border-white/10 bg-surface p-5 sm:p-6" aria-busy="true" aria-label="Loading saves, configs and backups">
            <div className="h-3 w-28 animate-pulse bg-white/10" />
            <div className="mt-3 h-8 w-64 max-w-full animate-pulse bg-white/10" />
            <div className="mt-5 h-20 animate-pulse border border-white/10 bg-white/[0.02]" />
        </section>
    );
}

async function LiveServerManagementPage({
    userId,
    accessError,
    accessLevel,
    accessToken,
    accessUpdated,
    managedServer,
    server,
}: {
    userId: string;
    accessError?: string;
    accessLevel: LiveConsoleAccessLevel;
    accessToken: string | null;
    accessUpdated?: string;
    managedServer: MyServerSummary | null;
    server: LiveConsoleServer;
}) {
    const canManageAssignments = accessLevel === "admin" || accessLevel === "owner";
    let assignmentLoadError = "";
    let assignmentWarning = "";
    let operators: LiveConsoleMember[] = [];
    let owner: LiveConsoleMember | null = null;

    if (canManageAssignments) {
        try {
            const result = await listSupabaseUsers();
            if (result.truncated) {
                assignmentLoadError = "The member directory is too large to manage assignments safely.";
            } else {
                const owners = result.users.filter((member) =>
                    getOwnedLiveConsoleServerIds(member.app_metadata).includes(server.id),
                );
                const operatorUsers = result.users.filter((member) =>
                    getOperatedLiveConsoleServerIds(member.app_metadata).includes(server.id),
                );

                owner = owners[0] ? getLiveConsoleMember(owners[0]) : null;
                operators = operatorUsers.map(getLiveConsoleMember);
                if (owners.length > 1) {
                    assignmentWarning = "Multiple owner assignments were found. Reassign the owner to repair access.";
                }
            }
        } catch (error) {
            console.error("Live server assignments failed to load", error);
            assignmentLoadError = "Owner and operator assignments could not be loaded.";
        }
    }

    return <ServerManagementWorkspace
        name={<EditableServerName key={server.name} canEdit={canManageAssignments} initialName={server.name} serverId={server.id} />}
        address={server.address}
        summary={<>{server.provider} · {accessLabels[accessLevel]} · Live dedicated server</>}
        initialSection={accessError || accessUpdated ? "Settings" : "Console"}
        notice="Protected production access. Controls and commands affect the live Bannerlord process immediately. The gateway revalidates your server access."
    >
        <ServerWorkspacePanel section="Console"><ServerConsoleWorkspace><LiveServerConsole gatewayUrl={getConsoleGatewayUrl()} serverId={server.id} /></ServerConsoleWorkspace></ServerWorkspacePanel>
        {managedServer !== null && accessToken !== null
            ? <ManagedServerSections userId={userId} accessToken={accessToken} server={managedServer} hasLiveConsole />
            : <UnavailableFileWorkspaces />}
        <ServerWorkspacePanel section="Settings">
            {managedServer !== null
                ? <ServerVisibilitySetting serverId={managedServer.serverId} visibility={managedServer.visibility} accessRole={managedServer.accessRole} expectedUpdatedAt={managedServer.updatedAt} />
                : <UnavailableServerPanel title="Directory visibility" actions={["Private", "Public"]} />}
            <section className="grid gap-3 sm:grid-cols-2" aria-label="Server information">
                <ResourceCard icon={Server} label="Provider" value={server.provider} />
                <ResourceCard icon={Container} label="Node" value={server.nodeId} />
            </section>
            {canManageAssignments && (
                    <section id="server-access" className="rounded-lg border border-white/10 bg-surface p-5 sm:p-6" aria-labelledby="server-access-heading">
                        <p className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-gold">
                            Delegated management
                        </p>
                        <h2 id="server-access-heading" className="mt-2 font-display text-2xl font-semibold text-foreground sm:text-3xl">
                            Server access
                        </h2>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-foreground-muted">
                            Administrators assign the owner. Administrators and the owner can grant operator access to this server.
                        </p>

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

function formatManagedValue(value: string) {
    return value
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

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
