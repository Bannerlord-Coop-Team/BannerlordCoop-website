import { getTranslations } from "@/app/lib/localization/server";
import Link from "next/link";

export type LiveServerBackupUnavailableReason = "lookup-failed" | "mapping-required" | "access-required";

/** Explains unavailable managed backup access without implying that live access grants it. */
export async function LiveServerBackupSetup({ reason, serverId }: {
    reason: LiveServerBackupUnavailableReason;
    serverId: string;
}) {
    const { t } = await getTranslations("live-server");
    return <section id="server-backups" aria-labelledby="server-backups-heading" className="rounded-lg border border-white/10 bg-surface p-5 sm:p-6">
        <h2 id="server-backups-heading" className="text-base font-semibold text-foreground">{t("backup.heading")}</h2>
        {reason === "lookup-failed" ? <>
            <p role="alert" className="mt-3 text-sm leading-6 text-foreground-muted">
                {t("backup.lookupFailed")}
            </p>
            <form action={`/servers/${encodeURIComponent(serverId)}#server-backups`} method="get" className="mt-4">
                <button type="submit" className="text-sm text-gold underline focus-visible:outline-2 focus-visible:outline-gold">{t("backup.reload")}</button>
            </form>
        </> : <>
            <p className="mt-3 text-sm leading-6 text-foreground-muted">
                {reason === "mapping-required"
                    ? t("backup.mappingRequired")
                    : t("backup.accessRequired")}
            </p>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-foreground-muted">
                <li>{t("backup.enroll")}</li>
                <li>{t("backup.permissions")}</li>
                <li>{t("backup.return")}</li>
            </ol>
            <p className="mt-3 text-sm leading-6 text-foreground-muted">{t("backup.migration")}</p>
            <Link href="/servers" className="mt-4 inline-block text-sm text-gold underline focus-visible:outline-2 focus-visible:outline-gold">{t("backup.servers")}</Link>
        </>}
    </section>;
}
