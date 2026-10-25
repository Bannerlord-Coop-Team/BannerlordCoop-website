import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** A list of rows inside a workspace card, such as backups, campaigns or managers. */
export const workspaceListClass = "divide-y divide-white/10 rounded-md border border-white/10";
/** The placeholder shown where a workspace list has nothing to show yet. */
export const workspaceEmptyClass = "rounded-md border border-dashed border-white/10 px-4 py-6 text-center text-sm text-foreground-muted";
/** An inline callout for state the owner should act on, such as a pending restart or a paused status check. */
export const workspaceNoticeClass = "rounded-md border border-gold/30 bg-gold/[0.06] px-3 py-2 text-sm text-foreground";
/** A heading for a group of rows inside a workspace card. */
export const workspaceSubheadingClass = "text-sm font-semibold text-foreground";
/** A small pill marking a row's state, such as Selected or In use. */
export const workspaceBadgeClass = "inline-flex items-center rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-xs font-medium text-gold";

type WorkspaceCardProps = Omit<ComponentPropsWithoutRef<"section">, "title"> & {
    headingId: string;
    title: ReactNode;
    icon?: LucideIcon;
    description?: ReactNode;
    actions?: ReactNode;
    tone?: "default" | "danger";
    /** Lets lists and editors run edge to edge instead of inside the padded body. */
    flush?: boolean;
};

/** Draws the card every server workspace tab uses: a titled header with its actions, above the card body. */
export function WorkspaceCard({ headingId, title, icon: Icon, description, actions, tone = "default", flush = false, className = "", children, ...section }: WorkspaceCardProps) {
    const danger = tone === "danger";
    return <section aria-labelledby={headingId} className={`min-w-0 rounded-lg border bg-surface ${danger ? "border-red-400/25" : "border-white/10"} ${className}`} {...section}>
        <div className={`flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 ${danger ? "border-red-400/20" : "border-white/10"}`}>
            <div className="min-w-0">
                <h2 id={headingId} className={`flex items-center gap-2 text-base font-semibold ${danger ? "text-red-200" : "text-foreground"}`}>
                    {Icon && <Icon aria-hidden="true" className={`size-4 shrink-0 ${danger ? "text-red-300" : "text-gold"}`} />}{title}
                </h2>
                {description && <div className="mt-1 text-sm leading-6 text-foreground-muted">{description}</div>}
            </div>
            {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
        </div>
        {flush ? children : <div className="p-5">{children}</div>}
    </section>;
}
