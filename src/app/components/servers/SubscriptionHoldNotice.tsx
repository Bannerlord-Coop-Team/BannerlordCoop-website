"use client";

import { useTranslations } from "@/app/lib/localization/client";
import { discordSupportSlots } from "@/app/components/ui/DiscordSupportLink";
import type { MyServerSummary } from "@/app/lib/control-plane/types";

/** A persistent notice follows the current hold; it disappears when funding is restored. */
export function SubscriptionHoldNotice({ hold, isOwner }: { hold: MyServerSummary["subscriptionHold"]; isOwner: boolean }) {
    const { t, rich } = useTranslations("managed-server");
    if (!hold) return null;
    return <aside role="alert" className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-4 text-sm">
        <p className="font-semibold">Subscription / funding lapsed</p>
        <p>{isOwner ? "Your subscription/funding lapsed." : "The owner’s subscription/funding lapsed."} The server is held and will be <strong>PERMANENTLY removed</strong> on <time dateTime={hold.removalDueAt}>{new Date(hold.removalDueAt).toUTCString()}</time> unless funding is restored before removal begins.</p>
        <p>{isOwner ? rich("hold.ownerHelp", discordSupportSlots(t, {
            accountLink: <a href="/account" className="underline">{t("hold.accountLink")}</a>,
        })) : rich("hold.viewerHelp", discordSupportSlots(t))}</p>
        {isOwner && hold.canExportSave && <p>Keep a copy now: open Save &amp; config, choose Export save, then Download save export before removal.</p>}
        {hold.state === "removal-pending" && <p>{rich("hold.removalHelp", discordSupportSlots(t))}</p>}
    </aside>;
}
