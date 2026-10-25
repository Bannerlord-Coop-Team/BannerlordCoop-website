"use client";

import { cheatsLabelClass } from "@/app/cheats/locale";
import { useTranslations } from "@/app/lib/localization/client";
import { ArrowRight, Check, X } from "lucide-react";
import Image from "next/image";

/** Patreon checkout for the $20 Veteran tier (reward 28995946); a qualifying membership funds one managed server. */
export const HOSTING_OFFER_CHECKOUT_URL = "https://www.patreon.com/checkout/BannerlordCoop?rid=28995946";

/** Patreon tier name, shown verbatim in every locale like other product names. */
export const HOSTING_OFFER_TIER = "Veteran";

/** Monthly tier price in whole US dollars; the campaign bills in USD. */
export const HOSTING_OFFER_PRICE_USD = 20;

const features = ["online", "backups", "updates", "support"] as const;

/**
 * Advertises managed hosting through the Veteran tier's Patreon checkout. The rail layout fills the
 * directory's xl column; the inline layout stacks on phones and becomes a banner from sm up.
 */
export function HostingOffer({ layout, onHide }: { layout: "rail" | "inline"; onHide: () => void }) {
    const { t, rich, number } = useTranslations("cheats");
    const inline = layout === "inline";
    const titleId = `hosting-offer-${layout}`;
    const price = number(HOSTING_OFFER_PRICE_USD, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });

    return (
        <aside
            aria-labelledby={titleId}
            className={`relative overflow-hidden border border-white/10 bg-surface${inline ? " sm:grid sm:grid-cols-[18.75rem_minmax(0,1fr)]" : ""}`}
        >
            <div className={inline ? "relative aspect-[9/4] sm:aspect-auto sm:min-h-56" : "relative h-40"}>
                <Image
                    src="/images/hosting/riders-band.webp"
                    alt=""
                    fill
                    sizes={inline ? "(min-width: 640px) 300px, 100vw" : "300px"}
                    className="object-cover object-[25%_50%]"
                />
                <div
                    aria-hidden="true"
                    className={`absolute inset-0 bg-linear-to-t from-surface via-surface/10 to-transparent${inline ? " sm:bg-linear-to-r sm:from-transparent sm:via-transparent sm:to-surface" : ""}`}
                />
                <span className={`absolute right-12 top-2.5 inline-flex items-center border border-white/15 bg-background/70 px-2 py-1 text-foreground-muted backdrop-blur-sm${inline ? " sm:right-2.5" : ""} ${cheatsLabelClass("badge")}`}>
                    {t("hostingOffer.label")}
                </span>
            </div>

            <div className={`relative -mt-3 px-5 pb-5${inline ? " sm:mt-0 sm:p-6" : ""}`}>
                <p
                    id={titleId}
                    className={`font-display text-[2rem] font-semibold leading-none text-foreground [&:lang(zh-CN)]:font-sans${inline ? " sm:pr-10" : ""}`}
                >
                    {t("hostingOffer.title")}
                </p>
                <p className="mt-2 text-sm leading-6 text-foreground-muted">{t("hostingOffer.description")}</p>
                <ul className={`mt-4 grid gap-2.5 text-sm leading-5 text-foreground${inline ? " lg:grid-cols-2 lg:gap-x-6" : ""}`}>
                    {features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2.5">
                            <span
                                aria-hidden="true"
                                className="mt-0.5 flex size-4 shrink-0 items-center justify-center border border-gold/45 bg-gold/10 text-gold"
                            >
                                <Check className="size-3" strokeWidth={3} />
                            </span>
                            {t(`hostingOffer.feature.${feature}`)}
                        </li>
                    ))}
                </ul>

                <div className={`mt-5 border-t border-white/10 pt-4${inline ? " sm:flex sm:flex-wrap sm:items-end sm:justify-between sm:gap-x-6 sm:gap-y-4" : ""}`}>
                    <div>
                        <p className="flex items-baseline gap-1 text-sm text-foreground-muted">
                            {rich("hostingOffer.price", {
                                amount: (
                                    <span className="font-display text-[2.5rem] font-semibold leading-none lining-nums text-foreground">
                                        {price}
                                    </span>
                                ),
                            })}
                        </p>
                        <p className={`mt-1 text-foreground-muted ${cheatsLabelClass("badge")}`}>
                            {rich("hostingOffer.tier", { tier: <span className="text-gold">{HOSTING_OFFER_TIER}</span> })}
                        </p>
                    </div>
                    <div className={inline ? "mt-4 sm:mt-0 sm:w-64" : "mt-4"}>
                        <a
                            href={HOSTING_OFFER_CHECKOUT_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-sm border border-crimson bg-crimson px-5 font-label text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors duration-200 hover:border-crimson-hover hover:bg-crimson-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson focus-visible:ring-offset-2 focus-visible:ring-offset-background [&:lang(zh-CN)]:normal-case [&:lang(zh-CN)]:tracking-normal"
                        >
                            {t("hostingOffer.cta")}
                            <span className="sr-only">{` ${t("hostingOffer.newTab")}`}</span>
                            <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
                        </a>
                        <p className="mt-3 text-center text-xs text-foreground-muted">{t("hostingOffer.finePrint")}</p>
                    </div>
                </div>
            </div>

            <button
                type="button"
                onClick={onHide}
                aria-label={t("hostingOffer.dismiss")}
                className="absolute right-2.5 top-2.5 flex size-8 items-center justify-center rounded-sm border border-white/15 bg-background/60 text-foreground-muted backdrop-blur-sm transition-colors duration-300 hover:border-gold/50 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
                <X aria-hidden="true" className="size-4" />
            </button>
        </aside>
    );
}
