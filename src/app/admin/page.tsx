import { RoleEditor } from "@/app/components/admin/RoleEditor";
import { getMemberRole, hasAdminAccess, isBootstrapAdmin } from "@/app/lib/auth/access";
import { getSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import type { User } from "@supabase/supabase-js";
import { ArrowLeft, Search, ShieldCheck, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
    title: "Member Administration | Bannerlord Coop",
    description: "Manage Bannerlord Coop member roles.",
};

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

type AdminPageProps = {
    searchParams: Promise<{
        error?: string | string[];
        q?: string | string[];
        updated?: string | string[];
    }>;
};

function firstValue(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
}

function memberName(user: User) {
    const metadata = user.user_metadata;
    return (
        metadata.full_name ??
        metadata.name ??
        metadata.user_name ??
        user.email?.split("@")[0] ??
        "Unnamed member"
    );
}

function initials(name: string) {
    return name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase();
}

function formatDate(value: string | undefined) {
    if (!value) return "Never";
    return new Intl.DateTimeFormat("en", {
        day: "numeric",
        month: "short",
        year: "numeric",
    }).format(new Date(value));
}

async function loadMembers() {
    const adminClient = getSupabaseAdminClient();
    const users: User[] = [];
    let truncated = false;

    for (let page = 1; page <= MAX_PAGES; page += 1) {
        const { data, error } = await adminClient.auth.admin.listUsers({
            page,
            perPage: PAGE_SIZE,
        });

        if (error) throw error;
        users.push(...data.users);

        if (data.users.length < PAGE_SIZE) break;
        if (page === MAX_PAGES) truncated = true;
    }

    return { users, truncated };
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
    const sessionClient = await getSupabaseServerClient();
    const { data: sessionData } = await sessionClient.auth.getUser();
    const currentUser = sessionData.user;

    if (!currentUser) redirect("/login?next=/admin");
    if (!hasAdminAccess(currentUser)) redirect("/");

    const params = await searchParams;
    const query = (firstValue(params.q) ?? "").trim().slice(0, 100);
    const errorMessage = firstValue(params.error);
    const successMessage = firstValue(params.updated);

    let members: User[] = [];
    let loadError = "";
    let truncated = false;

    try {
        const result = await loadMembers();
        members = result.users;
        truncated = result.truncated;
    } catch (error) {
        console.error("Member list failed to load", error);
        loadError =
            error instanceof Error && error.message.includes("SUPABASE_SECRET_KEY")
                ? error.message
                : "Members could not be loaded from Supabase.";
    }

    const normalizedQuery = query.toLowerCase();
    const filteredMembers = members
        .filter((member) => {
            if (!normalizedQuery) return true;
            const searchable = [
                memberName(member),
                member.email,
                member.app_metadata.provider,
                getMemberRole(member),
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            return searchable.includes(normalizedQuery);
        })
        .sort((left, right) => memberName(left).localeCompare(memberName(right)));

    return (
        <main className="min-h-svh bg-background">
            <header className="border-b border-white/10 bg-surface">
                <div className="site-container flex min-h-18 items-center justify-between gap-4 py-3">
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2 font-label text-xs font-semibold uppercase tracking-[0.14em] text-foreground-muted transition-colors hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                    >
                        <ArrowLeft aria-hidden="true" className="size-4" />
                        Back to site
                    </Link>
                    <div className="flex items-center gap-2 text-gold">
                        <ShieldCheck aria-hidden="true" className="size-5" />
                        <span className="font-label text-xs font-semibold uppercase tracking-[0.18em]">
                            Admin access
                        </span>
                    </div>
                </div>
            </header>

            <section className="site-container py-10 sm:py-14" aria-labelledby="admin-heading">
                <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
                    <div>
                        <p className="font-label text-xs font-semibold uppercase tracking-[0.22em] text-gold">
                            Community command
                        </p>
                        <h1
                            id="admin-heading"
                            className="mt-3 font-display text-4xl font-semibold text-foreground sm:text-5xl"
                        >
                            Member Administration
                        </h1>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted">
                            Search registered members and manage their access roles.
                            Role changes take effect the next time Supabase refreshes the member session.
                        </p>
                    </div>

                    <div className="flex items-center gap-3 rounded-sm border border-gold/20 bg-gold/[0.06] px-4 py-3">
                        <Users aria-hidden="true" className="size-5 text-gold" />
                        <div>
                            <p className="font-display text-2xl font-semibold leading-none text-foreground">
                                {members.length}
                            </p>
                            <p className="mt-1 font-label text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-foreground-muted">
                                Registered members
                            </p>
                        </div>
                    </div>
                </div>

                <form method="get" className="relative mt-10 max-w-xl">
                    <label htmlFor="member-search" className="sr-only">
                        Search members
                    </label>
                    <Search
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-foreground-dim"
                    />
                    <input
                        id="member-search"
                        type="search"
                        name="q"
                        defaultValue={query}
                        placeholder="Search by name, email, provider, or role"
                        className="min-h-12 w-full rounded-sm border border-white/15 bg-surface py-3 pr-28 pl-11 text-sm text-foreground outline-none placeholder:text-foreground-dim hover:border-white/25 focus:border-gold focus:ring-1 focus:ring-gold/30"
                    />
                    <button
                        type="submit"
                        className="absolute top-1.5 right-1.5 min-h-9 rounded-sm border border-crimson bg-crimson px-4 font-label text-xs font-semibold uppercase tracking-[0.12em] text-white transition-colors hover:border-crimson-hover hover:bg-crimson-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson"
                    >
                        Search
                    </button>
                </form>

                {(errorMessage || loadError) && (
                    <p role="alert" className="mt-6 border-l-2 border-crimson bg-crimson/10 px-4 py-3 text-sm text-red-200">
                        {errorMessage ?? loadError}
                    </p>
                )}
                {successMessage && !errorMessage && (
                    <p role="status" className="mt-6 border-l-2 border-emerald-500 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                        {successMessage}
                    </p>
                )}
                {truncated && (
                    <p className="mt-6 border-l-2 border-gold bg-gold/10 px-4 py-3 text-sm text-foreground-muted">
                        Only the first {PAGE_SIZE * MAX_PAGES} members are shown. Narrow your search or add database-backed pagination before exceeding this limit.
                    </p>
                )}

                <div className="mt-8 overflow-hidden rounded-sm border border-white/10 bg-surface">
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-215 border-collapse text-left">
                            <thead className="border-b border-white/10 bg-white/[0.025]">
                                <tr className="font-label text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-foreground-muted">
                                    <th scope="col" className="px-5 py-4">Member</th>
                                    <th scope="col" className="px-5 py-4">Provider</th>
                                    <th scope="col" className="px-5 py-4">Joined</th>
                                    <th scope="col" className="px-5 py-4">Last active</th>
                                    <th scope="col" className="px-5 py-4 text-right">Role</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.07]">
                                {filteredMembers.map((member) => {
                                    const name = memberName(member);
                                    const role = getMemberRole(member);
                                    const roleLocked =
                                        member.id === currentUser.id ||
                                        isBootstrapAdmin(member.email);

                                    return (
                                        <tr key={member.id} className="transition-colors hover:bg-white/[0.025]">
                                            <td className="px-5 py-4">
                                                <div className="flex items-center gap-3">
                                                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-gold/25 bg-gold/10 font-label text-xs font-bold text-gold">
                                                        {initials(name)}
                                                    </span>
                                                    <div className="min-w-0">
                                                        <p className="font-medium text-foreground">{name}</p>
                                                        <p className="mt-0.5 truncate text-xs text-foreground-muted">{member.email ?? "No email"}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-5 py-4 font-label text-xs uppercase tracking-[0.1em] text-foreground-muted">
                                                {member.app_metadata.provider ?? "email"}
                                            </td>
                                            <td className="px-5 py-4 text-sm text-foreground-muted">
                                                {formatDate(member.created_at)}
                                            </td>
                                            <td className="px-5 py-4 text-sm text-foreground-muted">
                                                {formatDate(member.last_sign_in_at)}
                                            </td>
                                            <td className="px-5 py-4">
                                                <RoleEditor
                                                    currentRole={role}
                                                    disabled={roleLocked}
                                                    query={query}
                                                    userId={member.id}
                                                />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {!loadError && filteredMembers.length === 0 && (
                        <div className="px-6 py-14 text-center">
                            <Users aria-hidden="true" className="mx-auto size-8 text-foreground-dim" />
                            <p className="mt-4 font-display text-2xl font-semibold text-foreground">
                                No members found
                            </p>
                            <p className="mt-2 text-sm text-foreground-muted">
                                Try another name, email, provider, or role.
                            </p>
                        </div>
                    )}
                </div>
            </section>
        </main>
    );
}
