import type { MyServerSummary } from "@/app/lib/control-plane/types";

/** A persistent notice follows the current hold; it disappears when funding is restored. */
export function SubscriptionHoldNotice({ hold, isOwner }: { hold: MyServerSummary["subscriptionHold"]; isOwner: boolean }) {
    if (!hold) return null;
    return <aside role="alert" className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-4 text-sm">
        <p className="font-semibold">Subscription / funding lapsed</p>
        <p>{isOwner ? "Your subscription/funding lapsed." : "The owner’s subscription/funding lapsed."} The server is held and will be <strong>PERMANENTLY removed</strong> on <time dateTime={hold.removalDueAt}>{new Date(hold.removalDueAt).toUTCString()}</time> unless funding is restored before removal begins.</p>
        {isOwner ? <p>Restore your qualifying subscription and check that the correct Patreon account is linked in <a href="/account" className="underline">your account</a>. Contact the hosting team if funding is already active.</p> : <p>The owner must restore qualifying funding before removal. Contact the hosting team if help is needed.</p>}
        {isOwner && hold.canExportSave && <p>Keep a copy now: open Save &amp; config, choose Export save, then Download save export before removal.</p>}
        {hold.state === "removal-pending" && <p>Removal is pending. Contact the hosting team immediately; restoring funding may be too late once removal has begun.</p>}
    </aside>;
}
