import { getTranslations } from "@/app/lib/localization/server";
import type { LucideIcon } from "lucide-react";
import { ScrollReveal } from "@/app/components/motion/ScrollReveal";

type StatCardProps = {
    label: string;
    description: string;
    value: number | null;
    status: string;
    icon: LucideIcon;
    isLive?: boolean;
    animationDelay?: number;
    loading?: boolean;
};


// Renders localized StatCard presentation while preserving source values.
export async function StatCard({ label, description, value, status, icon: Icon, isLive = false, animationDelay = 0, loading = false }: StatCardProps) {
    const { t, number } = await getTranslations("home");
    return (
        <ScrollReveal className="h-full" delay={animationDelay} distance={24} amount={0.2}>
            <article className="group relative h-full min-h-52 bg-surface-raised p-6 transition-colors duration-300 hover:bg-white/2.5 sm:min-h-56 sm:p-7">
                <div className="flex items-center justify-between gap-4">
                    <span className={`grid font-label text-xs font-semibold uppercase tracking-[0.2em] text-foreground-dim ${loading ? "bg-white/10" : ""}`}>
                        {/* Reserve both translated states, including wrapping, before the fetch settles. */}
                        <span aria-hidden="true" className="invisible col-start-1 row-start-1">{t("stats.unavailable")}</span>
                        <span aria-hidden="true" className="invisible col-start-1 row-start-1 flex items-center gap-2"><span className="size-1.5 shrink-0" />{t("stats.live")}</span>
                        <span aria-hidden={loading} className={`col-start-1 row-start-1 flex items-center gap-2 ${loading ? "invisible" : ""}`}>
                            {isLive && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-crimson shadow-[0_0_8px_rgba(143,29,35,0.9)]" />}
                            {status}
                        </span>
                    </span>
                    <Icon aria-hidden="true" className="size-5 text-gold-muted transition-colors duration-300 group-hover:text-gold" strokeWidth={1.5} />
                </div>
                <p className={`mt-7 grid font-display text-4xl font-semibold leading-none tabular-nums tracking-[-0.03em] text-foreground sm:mt-8 sm:text-5xl lg:text-6xl ${loading ? "bg-white/10" : ""}`}>
                    <span aria-hidden={loading || value === null} className={`col-start-1 row-start-1 whitespace-nowrap ${loading || value === null ? "invisible" : ""}`}>
                        {number(value ?? 0)}
                    </span>
                    <span aria-hidden={loading || value !== null} className={`col-start-1 row-start-1 font-label text-xl uppercase tracking-[0.1em] text-foreground-muted sm:text-2xl lg:text-3xl lg:tracking-[0.12em] ${loading || value !== null ? "invisible" : ""}`}>
                        {t("stats.notAvailable")}
                    </span>
                </p>
                <h3 className="mt-5 font-label text-sm font-semibold uppercase tracking-[0.18em] text-foreground">
                    {label}
                </h3>
                <p className="mt-2 font-sans text-xs leading-5 text-foreground-muted">
                    {description}
                </p>
                <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-crimson transition-transform duration-300 group-hover:scale-x-100" />
            </article>
        </ScrollReveal>
    );
}
