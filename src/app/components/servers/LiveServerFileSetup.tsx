import { getTranslations } from "@/app/lib/localization/server";
import Link from "next/link";
import type { LiveServerBackupUnavailableReason } from "./LiveServerBackupSetup";
import { ServerSaveConfigPanels } from "./ServerSaveConfigPanels";

/** Explains unavailable managed file access without implying that live access grants it. */
export async function LiveServerFileSetup({ reason, serverId }: {
    reason: LiveServerBackupUnavailableReason;
    serverId: string;
}) {
    const { t } = await getTranslations("live-server");
    return <div id="server-files" className="space-y-5">
        <section aria-labelledby="server-file-setup-heading" className="rounded-lg border border-white/10 bg-surface p-5 sm:p-6">
            <h2 id="server-file-setup-heading" className="text-base font-semibold">{t("file.heading")}</h2>
            {reason === "lookup-failed" ? <>
                <p role="alert" className="mt-3 text-sm leading-6 text-foreground-muted">{t("file.lookupFailed")}</p>
                <form action={`/servers/${encodeURIComponent(serverId)}#server-files`} method="get" className="mt-4">
                    <button type="submit" className="text-sm text-gold underline focus-visible:outline-2 focus-visible:outline-gold">{t("file.reload")}</button>
                </form>
            </> : <>
                <p className="mt-3 text-sm leading-6 text-foreground-muted">
                    {reason === "mapping-required"
                        ? t("file.mappingRequired")
                        : t("file.accessRequired")}
                </p>
                <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-foreground-muted">
                    <li>{t("file.enroll")}</li>
                    <li>{t("file.permissions")}</li>
                    <li>{t("file.return")}</li>
                </ol>
                <p className="mt-3 text-sm leading-6 text-foreground-muted">{t("file.migration")}</p>
                <Link href="/servers" className="mt-4 inline-block text-sm text-gold underline focus-visible:outline-2 focus-visible:outline-gold">{t("file.servers")}</Link>
            </>}
        </section>
        <ServerSaveConfigPanels />
    </div>;
}
