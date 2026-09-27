import Link from "next/link";
import type { LiveServerBackupUnavailableReason } from "./LiveServerBackupSetup";
import { ServerSaveConfigPanels } from "./ServerSaveConfigPanels";

export function LiveServerFileSetup({ reason, serverId }: {
    reason: LiveServerBackupUnavailableReason;
    serverId: string;
}) {
    return <div id="server-files" className="space-y-5">
        <section aria-labelledby="server-file-setup-heading" className="rounded-lg border border-white/10 bg-surface p-5 sm:p-6">
            <h2 id="server-file-setup-heading" className="text-base font-semibold">Connect save and configuration transfers</h2>
            {reason === "lookup-failed" ? <>
                <p role="alert" className="mt-3 text-sm leading-6 text-foreground-muted">Managed file access could not be checked. This does not mean your save or configuration is missing. Reload this page before trying a transfer.</p>
                <form action={`/servers/${encodeURIComponent(serverId)}#server-files`} method="get" className="mt-4">
                    <button type="submit" className="text-sm text-gold underline focus-visible:outline-2 focus-visible:outline-gold">Reload file access</button>
                </form>
            </> : <>
                <p className="mt-3 text-sm leading-6 text-foreground-muted">
                    {reason === "mapping-required"
                        ? "This live server is not connected to managed file transfers for your account."
                        : "The linked managed server is unavailable to your account. Ask an administrator to check the server link and your managed access."}
                    {" "}Live console access alone does not grant access to saves or configuration.
                </p>
                <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-foreground-muted">
                    <li>Ask an administrator to confirm this exact game server is enrolled in managed hosting and link its managed record.</li>
                    <li>Ask the managed owner for manager access, or an administrator to verify your managed ownership. Only the managed owner can import configuration.</li>
                    <li>Return to this tab to view the current campaign save and managed configuration and use the permitted transfers.</li>
                </ol>
                <p className="mt-3 text-sm leading-6 text-foreground-muted">A standalone server needs a planned migration first. Creating a new managed server does not copy this server or its saves.</p>
                <Link href="/servers" className="mt-4 inline-block text-sm text-gold underline focus-visible:outline-2 focus-visible:outline-gold">View managed servers and setup options</Link>
            </>}
        </section>
        <ServerSaveConfigPanels />
    </div>;
}
