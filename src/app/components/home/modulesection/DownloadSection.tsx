import { getTranslations } from "@/app/lib/localization/server";
import Link from "next/link";
import { ScrollReveal } from "@/app/components/motion/ScrollReveal";
import { DownloadModal } from "@/app/components/home/modulesection/DownloadModal";

const DISCORD_URL = "https://discord.gg/bannerlordcoop";

// Renders localized DownloadSection presentation while preserving source values.
export async function DownloadSection() {
    const { t } = await getTranslations("home");
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
                        {t("download.eyebrow")}
                    </p>

                    <h2
                        id="final-cta-heading"
                        className="mt-4 font-display text-4xl font-semibold uppercase leading-[0.9] tracking-[-0.03em] text-foreground min-[380px]:text-5xl sm:text-6xl lg:text-7xl 2xl:text-8xl"
                    >
                        {t("download.heading").split("\n").map((line, index, lines) => (
                                <span key={index} className={index === lines.length - 1 ? "block text-crimson" : "block"}>{line}</span>
                            ))}
                    </h2>

                    <p className="mx-auto mt-6 max-w-2xl font-sans text-base leading-7 text-foreground-muted sm:text-lg">
                        {t("download.description")}
                    </p>

                    <div className="mt-9 flex flex-col items-stretch justify-center gap-4 sm:flex-row sm:items-center">
                        <DownloadModal />

                        <Link
                            href={DISCORD_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex group min-h-12 w-full items-center justify-center gap-3 rounded-sm border border-white/20 bg-background/60 px-6 py-3 font-label text-sm font-semibold uppercase tracking-[0.14em] text-foreground transition-colors duration-300 hover:border-gold/60 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-13 sm:w-auto sm:px-7 sm:py-3.5 sm:tracking-[0.16em]"
                        >
                            <span
                                aria-hidden="true"
                                className="block size-5 shrink-0 bg-foreground-muted transition-[background-color, scale] duration-300 group-hover:scale-105 group-hover:bg-gold"
                                style={{
                                    WebkitMaskImage: "url('/images/discordlogo.svg')",
                                    maskImage: "url('/images/discordlogo.svg')",
                                    WebkitMaskRepeat: "no-repeat",
                                    maskRepeat: "no-repeat",
                                    WebkitMaskPosition: "center",
                                    maskPosition: "center",
                                    WebkitMaskSize: "contain",
                                    maskSize: "contain",
                                }}
                            />
                            {t("download.discord")}
                        </Link>
                    </div>

                    <ul className="mt-6 flex flex-wrap justify-center gap-x-3 gap-y-2 font-label text-xs uppercase tracking-[0.12em] text-foreground-dim sm:tracking-[0.14em]">
                        {[
                            t("download.free"),
                            t("download.platforms"),
                            t("download.requirement"),
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
