"use client";

import { CheatsDirectory, type CheatCommand } from "@/app/cheats/CheatsDirectory";
import { cheatsLabelClass } from "@/app/cheats/locale";
import { useTranslations } from "@/app/lib/localization/client";
import type { CheatsQuery } from "@/app/cheats/query";
import {
    CircleAlert,
    Keyboard,
    Monitor,
    Server,
} from "lucide-react";

/** Renders localized cheats content without maintaining a second language preference. */
export function CheatsView({
    commands,
    initialQuery,
}: {
    commands: readonly CheatCommand[];
    initialQuery: CheatsQuery;
}) {
    const { t, rich, number, locale } = useTranslations("cheats");
    const serverCount = commands.filter((command) => command.side === "server").length;
    const clientCount = commands.filter((command) => command.side === "client").length;

    return (
        <main className="min-h-svh bg-background" lang={locale}>
            <div className="site-container py-10 sm:py-14">
                <section className="flex flex-col justify-between gap-7 lg:flex-row lg:items-end" aria-labelledby="cheats-heading">
                    <div>
                        <div className="flex flex-wrap items-center gap-3">
                            <p className={cheatsLabelClass("eyebrow")}>
                                {t("ui.eyebrow")}
                            </p>
                        </div>
                        <h1 id="cheats-heading" className={`mt-3 text-4xl font-semibold text-foreground sm:text-5xl font-display [&:lang(zh-CN)]:font-sans`}>
                            {t("ui.title")}
                        </h1>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted sm:text-base">
                            {t("ui.intro")}
                        </p>
                    </div>

                    <dl className="grid grid-cols-3 border border-white/10 bg-surface">
                        <DirectoryStat icon={Keyboard} label={t("ui.commandsStat")} value={number(commands.length)} />
                        <DirectoryStat icon={Server} label={t("ui.serverStat")} value={number(serverCount)} />
                        <DirectoryStat icon={Monitor} label={t("ui.clientStat")} value={number(clientCount)} />
                    </dl>
                </section>

                <div
                    role="alert"
                    className="mt-8 flex gap-3 border-l-2 border-crimson bg-crimson/10 px-4 py-3.5 text-sm leading-6 text-red-200"
                >
                    <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-crimson-hover" />
                    <p>
                        {rich("ui.vanillaCampaignWarning", {
                            prefix: <code className="font-semibold text-red-100">campaign.</code>,
                        })}
                    </p>
                </div>

                <div className="mt-3 flex gap-3 border-l-2 border-gold bg-gold/[0.07] px-4 py-3.5 text-sm text-foreground-muted">
                    <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gold" />
                    <p>
                        <strong className="font-semibold text-foreground">{t("ui.consoleTip")}</strong>
                    </p>
                </div>

                <section className="mt-12 min-w-0 overflow-x-clip" aria-labelledby="cheat-directory-heading">
                    <div className="mb-5">
                        <p className={`${cheatsLabelClass("eyebrow")} text-[0.65rem]`}>
                            {t("ui.directoryEyebrow")}
                        </p>
                        <h2 id="cheat-directory-heading" className={`mt-2 text-3xl font-semibold text-foreground sm:text-4xl font-display [&:lang(zh-CN)]:font-sans`}>
                            {t("ui.directoryTitle")}
                        </h2>
                    </div>
                    <CheatsDirectory
                        commands={commands}
                        initialQuery={initialQuery}
                    />
                </section>
            </div>
        </main>
    );
}

/** Displays a localized directory count alongside its presentation label. */
function DirectoryStat({
    icon: Icon,
    label,
    value,
}: {
    icon: typeof Server;
    label: string;
    value: string;
}) {
    return (
        <div className="min-w-24 border-r border-white/10 px-4 py-3 sm:min-w-32 sm:px-5">
            <dt className={`flex items-center gap-1.5 text-foreground-muted ${cheatsLabelClass("badge")}`}>
                <Icon aria-hidden="true" className="size-3.5 text-gold-muted" />
                {label}
            </dt>
            <dd className="mt-1.5 font-display text-2xl font-semibold leading-none text-foreground">
                {value}
            </dd>
        </div>
    );
}
