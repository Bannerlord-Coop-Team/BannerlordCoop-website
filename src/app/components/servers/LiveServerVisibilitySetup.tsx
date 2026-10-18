import { getTranslations } from "@/app/lib/localization/server";
import Link from "next/link";

/** Explains unavailable managed visibility access without implying that live access grants it. */
export async function LiveServerVisibilitySetup({ reason, serverId }: {
    reason: "lookup-failed" | "mapping-required" | "access-required";
    serverId: string;
}) {
    const { t } = await getTranslations("live-server");
    return <section id="server-visibility" aria-labelledby="server-visibility-heading" className="rounded-lg border border-white/10 bg-surface p-5 sm:p-6">
        <h2 id="server-visibility-heading" className="text-base font-semibold text-foreground">{t("visibility.heading")}</h2>
        {reason === "lookup-failed" ? <>
            <p role="alert" className="mt-3 text-sm leading-6 text-foreground-muted">{t("visibility.lookupFailed")}</p>
            <form action={`/servers/${encodeURIComponent(serverId)}#server-visibility`} method="get" className="mt-4">
                <button type="submit" className="text-sm text-gold underline focus-visible:outline-2 focus-visible:outline-gold">{t("visibility.reload")}</button>
            </form>
        </> : <>
            <p className="mt-3 text-sm leading-6 text-foreground-muted">{reason === "mapping-required"
                ? t("visibility.mappingRequired")
                : t("visibility.accessRequired")}</p>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-foreground-muted">
                <li>{t("visibility.enroll")}</li>
                <li>{t("visibility.permissions")}</li>
                <li>{t("visibility.return")}</li>
            </ol>
            <p className="mt-3 text-sm leading-6 text-foreground-muted">{t("visibility.migration")}</p>
            <Link href="/servers" className="mt-4 inline-block text-sm text-gold underline focus-visible:outline-2 focus-visible:outline-gold">{t("visibility.servers")}</Link>
        </>}
    </section>;
}
