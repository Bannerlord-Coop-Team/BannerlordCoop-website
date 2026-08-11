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
};

const numberFormatter = new Intl.NumberFormat("en-US");

export function StatCard({ label, description, value, status, icon: Icon, isLive = false, animationDelay = 0 }: StatCardProps) {
    return (
        <ScrollReveal className="h-full" delay={animationDelay} distance={24} amount={0.2}>
            <article className="group relative h-full min-h-56 bg-surface-raised p-7 transition-colors duration-300 hover:bg-white/2.5">
                <div className="flex items-center justify-between gap-4">
                    <span className="flex items-center gap-2 font-label text-xs font-semibold uppercase tracking-[0.2em] text-foreground-dim">
                        {isLive && <span aria-hidden="true" className="size-1.5 rounded-full bg-crimson shadow-[0_0_8px_rgba(143,29,35,0.9)]" />}
                        {status}
                    </span>
                    <Icon aria-hidden="true" className="size-5 text-gold-muted transition-colors duration-300 group-hover:text-gold" strokeWidth={1.5} />
                </div>
                <p className="mt-8 font-display text-5xl font-semibold leading-none tabular-nums tracking-[-0.03em] text-foreground sm:text-6xl">
                    {value === null ? (
                        <span className="font-label text-2xl uppercase tracking-[0.12em] text-foreground-muted sm:text-3xl">
                            Not available
                        </span>
                    ) : (
                        numberFormatter.format(value)
                    )}
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