import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { ScrollReveal } from "@/app/components/motion/ScrollReveal";
import { DownloadModal } from "@/app/components/home/modulesection/DownloadModal";

const DISCORD_URL = "https://discord.gg/bannerlordcoop";

export function DownloadSection() {
    return (
        <section
            id="download"
            className="relative overflow-hidden border-b border-white/10 bg-background py-24 sm:py-32"
            aria-labelledby="final-cta-heading"
        >
            <div
                aria-hidden="true"
                className="absolute inset-0 bg-[radial-gradient(circle_at_50%_55%,rgba(143,29,35,0.16),transparent_44%)]"
            />

            <div
                aria-hidden="true"
                className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(143,29,35,0.04),transparent_35%,rgba(143,29,35,0.035))]"
            />

            <div className="site-container relative">
                <ScrollReveal
                    className="mx-auto max-w-5xl text-center"
                    amount={0.3}
                >
                    <p className="font-label text-sm font-semibold uppercase tracking-[0.24em] text-gold">
                        Download Bannerlord Coop
                    </p>

                    <h2
                        id="final-cta-heading"
                        className="mt-4 font-display text-5xl font-semibold uppercase leading-[0.88] tracking-[-0.035em] text-foreground sm:text-6xl lg:text-7xl"
                    >
                        The Realm Awaits.
                        <span className="block text-crimson">
                            Bring Friends.
                        </span>
                    </h2>

                    <p className="mx-auto mt-6 max-w-2xl font-sans text-base leading-7 text-foreground-muted sm:text-lg">
                        Choose your preferred download platform, install the Coop
                        module, and start a shared campaign with your friends.
                    </p>

                    <div className="mt-9 flex flex-col items-stretch justify-center gap-4 sm:flex-row sm:items-center">
                        <DownloadModal />

                        <Link
                            href={DISCORD_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-13 items-center justify-center gap-3 rounded-sm border border-white/20 bg-background/60 px-7 py-3.5 font-label text-sm font-semibold uppercase tracking-[0.16em] text-foreground transition-colors duration-300 hover:border-gold/60 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        >
                            <MessageCircle
                                aria-hidden="true"
                                className="size-4"
                                strokeWidth={1.75}
                            />
                            Join Our Discord
                        </Link>
                    </div>

                    <p className="mt-6 font-label text-xs uppercase tracking-[0.14em] text-foreground-dim">
                        A Free Community Mod
                        <span
                            aria-hidden="true"
                            className="mx-3 text-gold-muted"
                        >
                            /
                        </span>

                        Windows &amp; Linux
                        <span
                            aria-hidden="true"
                            className="mx-3 text-gold-muted"
                        >
                            /
                        </span>
                        Requires A Legal Copy Of Mount &amp; Blade II: Bannerlord
                    </p>
                </ScrollReveal>
            </div>
        </section>
    );
}