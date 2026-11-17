import Image from "next/image";
import type { ReactNode } from "react";
import { eyebrowClass } from "./styles";

/** Frames one nightly page: the site's hero backdrop with a single bordered card and its eyebrow. */
export function NightlyCard({ eyebrow, wide = false, children }: { eyebrow: string; wide?: boolean; children: ReactNode }) {
    return (
        <section className="relative isolate flex-1 overflow-hidden border-b border-white/10">
            <Image
                src="/images/singleleader.png"
                alt=""
                fill
                priority
                sizes="100vw"
                className="-z-20 object-cover object-[62%_center] opacity-30"
            />
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-r from-background via-background/85 to-background/50" />
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_23%_55%,rgba(143,29,35,0.18),transparent_35%)]" />
            <div className="site-container py-12 sm:py-16 lg:py-20">
                <div className={`relative border border-white/10 bg-surface/90 px-6 py-9 shadow-[0_28px_90px_rgba(0,0,0,0.38)] sm:px-10 sm:py-12 ${wide ? "max-w-5xl" : "max-w-3xl"}`}>
                    <span aria-hidden="true" className="absolute -top-px left-6 h-0.5 w-20 bg-gold sm:left-10" />
                    <p className={eyebrowClass}>{eyebrow}</p>
                    <div className="mt-4">{children}</div>
                </div>
            </div>
        </section>
    );
}
