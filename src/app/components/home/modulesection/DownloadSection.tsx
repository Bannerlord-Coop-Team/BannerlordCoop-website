import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { ScrollReveal } from "@/app/components/motion/ScrollReveal";
import { DownloadModal } from "@/app/components/home/modulesection/DownloadModal";

const DISCORD_URL = "https://discord.gg/bannerlordcoop";

export function DownloadSection() {
    return (
        <section
            id="download"
            className="relative overflow-hidden border-b border-white/10 bg-background py-16 sm:py-20 lg:py-28 2xl:py-32"
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
                    <p className="font-label text-xs font-semibold uppercase tracking-[0.18em] text-gold sm:text-sm sm:tracking-[0.24em]">
                        Download Bannerlord Coop
                    </p>

                    <h2
                        id="final-cta-heading"
                        className="mt-4 font-display text-4xl font-semibold uppercase leading-[0.9] tracking-[-0.03em] text-foreground min-[380px]:text-5xl sm:text-6xl lg:text-7xl 2xl:text-8xl"
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
                            className="inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-sm border border-white/20 bg-background/60 px-6 py-3 font-label text-sm font-semibold uppercase tracking-[0.14em] text-foreground transition-colors duration-300 hover:border-gold/60 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-13 sm:w-auto sm:px-7 sm:py-3.5 sm:tracking-[0.16em]"
                        >
                            <MessageCircle
                                aria-hidden="true"
                                className="size-4"
                                strokeWidth={1.75}
                            />
                            Join Our Discord
                        </Link>
                    </div>

                    <ul className="mt-6 flex flex-wrap justify-center gap-x-3 gap-y-2 font-label text-xs uppercase tracking-[0.12em] text-foreground-dim sm:tracking-[0.14em]">
                        {[
                            "A Free Community Mod",
                            "Windows & Linux",
                            "Requires A Legal Copy Of Mount & Blade II: Bannerlord",
                        ].map((item, index) => (
                            <li key={item} className="flex items-center gap-3">
                                {index > 0 && (
                                    <span aria-hidden="true" className="text-gold-muted">/</span>
                                )}
                                <span>{item}</span>
                            </li>
                        ))}
                    </ul>
                </ScrollReveal>
            </div>
        </section>
    );
}