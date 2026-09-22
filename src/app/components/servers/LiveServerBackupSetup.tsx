import Link from "next/link";

export type LiveServerBackupUnavailableReason = "lookup-failed" | "mapping-required" | "access-required";

export function LiveServerBackupSetup({ reason, serverId }: {
    reason: LiveServerBackupUnavailableReason;
    serverId: string;
}) {
    return <section id="server-backups" aria-labelledby="server-backups-heading" className="rounded-lg border border-white/10 bg-surface p-5 sm:p-6">
        <h2 id="server-backups-heading" className="text-base font-semibold text-foreground">Backups and restore</h2>
        {reason === "lookup-failed" ? <>
            <p role="alert" className="mt-3 text-sm leading-6 text-foreground-muted">
                Managed backup access could not be checked. This does not mean your backups are missing. Reload this page before trying a backup operation.
            </p>
            <a href={`/servers/${encodeURIComponent(serverId)}#server-backups`} className="mt-4 inline-block text-sm text-gold underline focus-visible:outline-2 focus-visible:outline-gold">Reload backup access</a>
        </> : <>
            <p className="mt-3 text-sm leading-6 text-foreground-muted">
                {reason === "mapping-required"
                    ? "This live server is not connected to managed backups for your account."
                    : "The linked managed server is unavailable to your account. Ask an administrator to check the server link and your managed access."}
                {" "}Live console access alone does not grant access to backup history, backup creation, or save restore.
            </p>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-foreground-muted">
                <li>Ask an administrator to confirm this exact game server is enrolled in managed hosting and link its managed record.</li>
                <li>Ask the managed owner for manager access, or an administrator to verify your managed ownership.</li>
                <li>Return to this tab to view real backup history, create a backup, or restore an available save.</li>
            </ol>
            <p className="mt-3 text-sm leading-6 text-foreground-muted">A standalone server needs a planned migration first. Creating a new managed server does not copy this server or its saves.</p>
            <Link href="/servers" className="mt-4 inline-block text-sm text-gold underline focus-visible:outline-2 focus-visible:outline-gold">View managed servers and setup options</Link>
        </>}
    </section>;
}
