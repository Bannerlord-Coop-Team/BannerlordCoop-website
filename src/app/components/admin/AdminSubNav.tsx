"use client";

import { CloudCog, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type AdminLink = { href: string; label: string; icon: LucideIcon; exact: boolean };

// Members is the /admin index, so it only matches exactly; sections match their nested paths too.
const ADMIN_LINKS: readonly AdminLink[] = [
    { href: "/admin", label: "Members", icon: Users, exact: true },
    { href: "/admin/control-plane", label: "Control Plane", icon: CloudCog, exact: false },
];

const linkClassName = "inline-flex min-h-10 items-center gap-2 whitespace-nowrap border px-3 py-2 font-label text-[0.65rem] font-semibold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold";
const activeLinkClassName = "border-gold/30 bg-gold/8 text-gold";
const inactiveLinkClassName = "border-white/15 text-foreground-muted hover:border-gold/40 hover:text-gold";

/** Decides whether an admin section link represents the current pathname. */
function isAdminLinkActive(link: AdminLink, pathname: string) {
    if (pathname === link.href) return true;
    if (link.exact) return false;
    return pathname.startsWith(`${link.href}/`);
}

/** Renders the admin section links under the site navbar, marking the current section. */
export function AdminSubNav() {
    const pathname = usePathname();

    return (
        <div className="border-b border-white/10 bg-surface">
            <div className="site-container flex min-h-14 items-center justify-between gap-3">
                <nav aria-label="Administration" className="min-w-0 overflow-x-auto">
                    <ul className="flex items-center gap-2 p-1">
                        {ADMIN_LINKS.map((link) => {
                            const active = isAdminLinkActive(link, pathname);
                            const Icon = link.icon;
                            return (
                                <li key={link.href} className="shrink-0">
                                    <Link
                                        href={link.href}
                                        aria-current={active ? "page" : undefined}
                                        className={`${linkClassName} ${active ? activeLinkClassName : inactiveLinkClassName}`}
                                    >
                                        <Icon aria-hidden="true" className="size-4" /> {link.label}
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </nav>
                <span className="inline-flex shrink-0 items-center gap-2 text-gold" title="Admin access">
                    <ShieldCheck aria-hidden="true" className="size-5" />
                    <span className="sr-only font-label text-xs font-semibold uppercase tracking-[0.18em] min-[480px]:not-sr-only">Admin access</span>
                </span>
            </div>
        </div>
    );
}
