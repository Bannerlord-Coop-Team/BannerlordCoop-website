import { LocalizationProvider } from "@/app/lib/localization/client";
import { getLocale, getMessages, getTranslations } from "@/app/lib/localization/server";
import { Suspense } from "react";
import { MembershipNextStep } from "@/app/components/servers/MembershipNextStep";
import { composeOnboarding, identityStep, type AccountStatus } from "@/app/lib/hosting/membership-onboarding";
import { Navbar } from "@/app/components/layout/Navbar";
import { AllServersDirectory } from "@/app/components/servers/AllServersDirectory";
import {
    ServerDirectoryTable,
    type ManagedServerDirectoryEntry,
} from "@/app/components/servers/ServerDirectoryTable";
import { getLiveConsoleAccessLevel } from "@/app/lib/auth/access";
import { listLiveConsoleServers } from "@/app/lib/console/servers";
import type { MyServerSummary } from "@/app/lib/control-plane/types";
import { getServerOnboarding, listAllMyServers } from "@/app/lib/hosting/my-servers-server";
import { prepareWebsiteAccountStatusRequest } from "@/app/lib/hosting/website-account-status";
import { ServerOnboarding } from "@/app/components/servers/ServerOnboarding";
import type { OnboardingSummary } from "../../../supabase/functions/_shared/server-onboarding-contract";
import { getServerDisplayNames } from "@/app/lib/hosting/server-settings";
import { listPublicServers } from "@/app/lib/hosting/public-servers";
import { connectionAddress } from "@/app/lib/hosting/connection-address";
import { getSupabaseServerViewer } from "@/app/lib/supabase/server";
import {
    LoaderCircle,
    Server,
    ShieldCheck,
} from "lucide-react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";

/** Resolves directory metadata from the same explicit locale as its content. */
export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getTranslations("servers");
    return { title: t("metadata.title"), description: t("metadata.description") };
}

/** Starts independent requests without holding the directory shell behind account status. */
export default async function ServersPage() {
    const publicInventory = loadPublicInventory();
    const viewer = loadViewer();
    const managedInventory = viewer.then(({ user, accessToken, inventory }) => loadManagedInventory(user, accessToken, inventory));
    const hostingStatus = viewer.then(({ user, accessToken, accountRead }) => loadHostingStatus(user, accessToken, accountRead));

    const locale = await getLocale();
    const [{ t, number }, messages] = await Promise.all([getTranslations("servers", locale), getMessages(["servers", "server-common"], locale)]);

    return (
        <LocalizationProvider locale={locale} messages={messages}>
            <Suspense fallback={<div role="status" aria-label={t("page.navigation")} className="h-16 border-b border-white/10 bg-background" />}>
                <Navbar viewer={viewer.then(({ user }) => ({ user }))} />
            </Suspense>
            <main className="min-h-svh bg-background">
                <div className="site-container py-10 sm:py-14">
                <section className="flex flex-col justify-between gap-7 lg:flex-row lg:items-end" aria-labelledby="servers-heading">
                    <div>
                        <p className="font-label text-xs font-semibold uppercase tracking-[0.22em] text-gold">
                            {t("page.eyebrow")}
                        </p>
                        <h1 id="servers-heading" className="mt-3 font-display text-4xl font-semibold text-foreground sm:text-5xl">
                            {t("page.heading")}
                        </h1>
                    </div>

                    <Suspense fallback={<DirectoryLoading label={t("page.counts")} />}>
                        {publicInventory.then(({ allServers, publicServersError }) => (
                            <dl className="grid grid-cols-2 border border-white/10 bg-surface">
                                <DirectoryStat icon={Server} label={t("page.publicTotal")} value={publicServersError ? t("table.unknownPlayers") : number(allServers.length)} />
                                <DirectoryStat icon={ShieldCheck} label={t("page.onlineTotal")} value={publicServersError ? t("table.unknownPlayers") : number(allServers.filter(server => server.status === "Online").length)} />
                            </dl>
                        ))}
                    </Suspense>
                </section>

                <Suspense fallback={<DirectoryLoading label={t("page.hosting")} />}>
                    {Promise.all([hostingStatus, managedInventory]).then(([{ user, identity, account, onboarding }, { ownedIds }]) => {
                        const websiteSummary = composeOnboarding(user?.id ?? null, identity, account, onboarding, ownedIds);
                        return user ? <ServerOnboarding userId={user.id} summary={onboarding} websiteSummary={websiteSummary} /> : <MembershipNextStep summary={websiteSummary} />;
                    })}
                </Suspense>

                <section id="my-servers" className="mt-12" aria-labelledby="my-servers-heading">
                    <div className="mb-5 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
                        <div>
                            <p className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-gold">
                                {t("page.myEyebrow")}
                            </p>
                            <h2 id="my-servers-heading" className="mt-2 font-display text-3xl font-semibold text-foreground sm:text-4xl">
                                {t("page.myHeading")}
                            </h2>
                        </div>
                    </div>
                    <Suspense fallback={<DirectoryLoading label={t("page.managed")} />}>
                        {managedInventory.then(({ user, managedServers, managedServersError, ownedIds }) => (
                            user ? (
                                <div>
                                    <p className="mb-4 text-sm text-foreground-muted">{t("page.associatedCount", { count: managedServers.length, countLabel: number(managedServers.length) })}</p>
                                    {managedServersError && (
                                        <p role="alert" className="mb-4 border-l-2 border-crimson bg-crimson/10 px-4 py-3 text-sm text-red-200">
                                            {t(managedServersError)}
                                        </p>
                                    )}
                                    <h3 className="mb-3 font-semibold">{t("page.ownedHeading")}</h3>
                                    <ServerDirectoryTable servers={managedServers.filter(server => ownedIds.includes(server.id))} emptyMessage={t("page.noOwned")} />
                                    <h3 className="mb-3 mt-6 font-semibold">{t("page.associatedHeading")}</h3>
                                    <ServerDirectoryTable
                                        servers={managedServers.filter(server => !ownedIds.includes(server.id))}
                                        emptyMessage={managedServersError
                                            ? t("page.noManaged")
                                            : t("page.noAssociated")}
                                    />
                                </div>
                            ) : (
                                <div className="flex min-h-36 flex-col items-center justify-center gap-4 border border-dashed border-white/15 bg-surface px-6 text-center">
                                    <p className="text-sm text-foreground-muted">
                                        {t("page.signInHint")}
                                    </p>
                                    <Link
                                        href="/login?next=/servers"
                                        className="inline-flex min-h-10 items-center justify-center border border-gold/35 bg-gold/[0.07] px-5 font-label text-xs font-semibold uppercase tracking-[0.12em] text-gold transition-colors hover:border-gold/60 hover:bg-gold/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                                    >
                                        {t("page.signIn")}
                                    </Link>
                                </div>
                            )
                        ))}
                    </Suspense>
                </section>

                <section className="mt-14" aria-labelledby="all-servers-heading">
                    <div className="mb-5 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
                        <div>
                            <p className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-gold">
                                {t("page.publicEyebrow")}
                            </p>
                            <h2 id="all-servers-heading" className="mt-2 font-display text-3xl font-semibold text-foreground sm:text-4xl">
                                {t("page.publicHeading")}
                            </h2>
                        </div>
                    </div>
                    <Suspense fallback={<DirectoryLoading label={t("page.public")} />}>
                        {publicInventory.then(({ allServers, publicServersError }) => <>
                            <p className="mb-4 text-sm text-foreground-muted">
                                {publicServersError ? t("page.unavailable") : t("page.publicCount", { count: allServers.length, countLabel: number(allServers.length) })}
                            </p>
                        {publicServersError ? (
                            <p role="alert" className="border-l-2 border-crimson bg-crimson/10 px-4 py-3 text-sm text-red-200">{t(publicServersError)}</p>
                        ) : <AllServersDirectory servers={allServers} />}
                        </>)}
                    </Suspense>
                </section>
                </div>
            </main>
        </LocalizationProvider>
    );
}

/** Private requests share one verified user/session pair for this render. */
async function loadViewer() {
    let user: User | null = null;
    let accessToken: string | null = null;
    let client: SupabaseClient | null = null;
    let inventory: Promise<PromiseSettledResult<MyServerSummary[]>> | undefined;
    let accountRead: Promise<PromiseSettledResult<Awaited<ReturnType<typeof prepareWebsiteAccountStatusRequest>>>> | undefined;
    const controller = new AbortController();

    try {
        const viewer = await getSupabaseServerViewer({
            // The owner API checks its own current authority. Never render this
            // read before the viewer also verifies the matching user/session.
            onReadOnlySession: token => ({
                inventory: Promise.allSettled([listAllMyServers(token, controller.signal)]).then(([result]) => result),
                account: Promise.allSettled([prepareWebsiteAccountStatusRequest(token)]).then(([result]) => result),
            }),
        });
        ({ client, user, accessToken } = viewer);
        inventory = viewer.read?.inventory;
        accountRead = viewer.read?.account;
        if (!user || !accessToken) controller.abort();
    } catch {
        controller.abort();
        // Keep the public server directory available when auth is not configured.
    }

    return { user, accessToken, client, inventory, accountRead };
}

/** Resolve names only for live servers the verified user can manage. */
async function loadLiveServers(user: User | null) {
    const accessibleLiveServers = user
        ? listLiveConsoleServers().filter((server) =>
            getLiveConsoleAccessLevel(user, server.id),
        )
        : [];
    const liveServerDisplayNames = await getServerDisplayNames(
        accessibleLiveServers.map((server) => server.id),
    );
    const liveServers: ManagedServerDirectoryEntry[] = accessibleLiveServers.map(
        (server) => ({
            id: server.id,
            name: liveServerDisplayNames.get(server.id) ?? server.name,
            status: "Unknown",
            connectionType: "Direct",
            joinUrl: `bannerlordcoop://join/${server.id}`,
            players: null,
            manageUrl: `/servers/${encodeURIComponent(server.id)}`,
        }),
    );
    return liveServers;
}

/** Keep account synchronization before allocation reads, outside either directory's path. */
async function loadHostingStatus(user: User | null, accessToken: string | null,
    accountRead: Promise<PromiseSettledResult<Awaited<ReturnType<typeof prepareWebsiteAccountStatusRequest>>>> | undefined) {
    // Resolve authoritative identities before any allocation fetch. No metadata/email fallback.
    const identity = identityStep(user);
    let account: AccountStatus | null = null;
    if (user && accessToken) {
        try {
            if (!accountRead) throw new Error("Account read was not prepared.");
            const prepared = await accountRead;
            if (prepared.status === "rejected") throw prepared.reason;
            account = await prepared.value(user);
        } catch { /* Independent CP grants must remain usable during membership outages. */ }
    }
    let onboarding: OnboardingSummary | null = null;
    if (user && accessToken && identity === null) {
        try { onboarding = await getServerOnboarding(accessToken); }
        catch { /* Unknown eligibility/capacity must never become a positive or empty snapshot. */ }
    }
    return { user, identity, account, onboarding };
}

/** Loads private inventory once, in parallel with live display names. */
async function loadManagedInventory(user: User | null, accessToken: string | null,
    inventory: Promise<PromiseSettledResult<MyServerSummary[]>> | undefined) {
    const liveServers = loadLiveServers(user);
    let listed: MyServerSummary[] = [];
    let managedServersError = "";
    if (user) {
        if (!accessToken) {
            managedServersError = "page.error.sessionUnavailable";
        } else {
            try {
                if (!inventory) throw new Error("Authenticated inventory read was not started.");
                const result = await inventory;
                if (result.status === "rejected") throw result.reason;
                listed = result.value;
            } catch (error) {
                console.error("Managed server inventory failed to load", error);
                managedServersError = "page.error.managedUnavailable";
            }
        }
    }
    return {
        user,
        managedServers: uniqueServers([...listed.map(toDirectoryServer), ...await liveServers]),
        managedServersError,
        ownedIds: listed.filter(server => server.accessRole === "owner").map(server => server.serverId),
    };
}

/** Loads public inventory independently, keeping failures inside its section. */
async function loadPublicInventory() {
    let allServers: ManagedServerDirectoryEntry[] = [];
    let publicServersError = "";
    try {
        allServers = (await listPublicServers()).map(server => ({
            id: server.serverId,
            name: server.displayName,
            status: server.observedGameState === "running" ? "Online" : server.observedGameState === "stopped" ? "Offline" : "Unknown",
            connectionType: "Direct",
            joinUrl: "",
            connectionAddress: connectionAddress(server.connectionIp, server.gamePorts),
            players: null,
        }));
    } catch {
        publicServersError = "page.error.publicUnavailable";
    }
    return { allServers, publicServersError };
}

/** Announces a section's pending data while respecting reduced-motion preferences. */
function DirectoryLoading({ label }: { label: string }) {
    return <div role="status" className="flex min-h-24 items-center justify-center gap-3 text-sm text-foreground-muted">
        <LoaderCircle aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />
        <span>{label}</span>
    </div>;
}

/** Maps an authenticated server record into its directory presentation. */
function toDirectoryServer(server: MyServerSummary): ManagedServerDirectoryEntry {
    const isRunning = server.observedGameState === "running";
    const isStopped = server.observedGameState === "stopped"
        || ["stopped", "suspended"].includes(server.operationState);
    return {
        id: server.serverId,
        name: server.displayName,
        status: isRunning ? "Online" : isStopped ? "Offline" : "Unknown",
        connectionType: "Direct",
        joinUrl: `bannerlordcoop://join/${encodeURIComponent(server.serverId)}`,
        connectionAddress: connectionAddress(server.connectionIp ?? null, server.gamePorts ?? []),
        players: null,
        manageUrl: `/servers/${encodeURIComponent(server.serverId)}`,
    };
}

/** Merges live and managed entries without duplicating server identities. */
function uniqueServers(servers: readonly ManagedServerDirectoryEntry[]) {
    const unique = new Map<string, ManagedServerDirectoryEntry>();
    for (const server of servers) {
        const existing = unique.get(server.id);
        unique.set(server.id, existing === undefined
            ? server
            : {
                ...server,
                ...existing,
                manageUrl: server.manageUrl ?? existing.manageUrl,
            });
    }
    return [...unique.values()];
}

/** Displays one public-directory total. */
function DirectoryStat({
    icon: Icon,
    label,
    value,
}: {
    icon: typeof Server;
    label: string;
    value: number | string;
}) {
    return (
        <div className="min-w-24 border-r border-white/10 px-4 py-3 last:border-r-0 sm:min-w-32 sm:px-5">
            <dt className="flex items-center gap-1.5 font-label text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-foreground-muted">
                <Icon aria-hidden="true" className="size-3.5 text-gold-muted" />
                {label}
            </dt>
            <dd className="mt-1.5 font-display text-2xl font-semibold leading-none text-foreground">
                {value}
            </dd>
        </div>
    );
}
