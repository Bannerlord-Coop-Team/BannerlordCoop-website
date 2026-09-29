import Link from "next/link";

export function LiveServerVisibilitySetup({ reason, serverId }: {
    reason: "lookup-failed" | "mapping-required" | "access-required";
    serverId: string;
}) {
    return <section id="server-visibility" aria-labelledby="server-visibility-heading" className="rounded-lg border border-white/10 bg-surface p-5 sm:p-6">
        <h2 id="server-visibility-heading" className="text-base font-semibold text-foreground">Connect directory visibility</h2>
        {reason === "lookup-failed" ? <>
            <p role="alert" className="mt-3 text-sm leading-6 text-foreground-muted">Managed visibility could not be checked. The current directory setting is unknown; reload before trying to change it.</p>
            <form action={`/servers/${encodeURIComponent(serverId)}#server-visibility`} method="get" className="mt-4">
                <button type="submit" className="text-sm text-gold underline focus-visible:outline-2 focus-visible:outline-gold">Reload visibility access</button>
            </form>
        </> : <>
            <p className="mt-3 text-sm leading-6 text-foreground-muted">{reason === "mapping-required"
                ? "This live server has no managed visibility record available to your account."
                : "The linked managed server is unavailable to your account. Ask an administrator to check the server link and your managed access."}</p>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-foreground-muted">
                <li>Ask an administrator to confirm this exact game server is enrolled in managed hosting and link its managed record. A standalone server needs a planned migration first.</li>
                <li>Ask an administrator to verify the managed owner. Live console ownership and operator access do not grant permission to change directory visibility.</li>
                <li>Return to Settings. The managed owner can choose Public or Private and save; other authorized accounts can view the current setting.</li>
            </ol>
            <p className="mt-3 text-sm leading-6 text-foreground-muted">Linking a server does not publish it. Creating a new managed server does not migrate this server or its saves. Directory visibility does not grant management access or change game connection permissions.</p>
            <Link href="/servers" className="mt-4 inline-block text-sm text-gold underline focus-visible:outline-2 focus-visible:outline-gold">View managed servers and setup options</Link>
        </>}
    </section>;
}
