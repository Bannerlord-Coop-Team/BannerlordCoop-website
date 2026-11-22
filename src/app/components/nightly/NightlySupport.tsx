"use client";

import { discordSupportSlots } from "@/app/components/ui/DiscordSupportLink";
import { useTranslations } from "@/app/lib/localization/client";
import { GENERIC_ERROR_MESSAGE } from "@/app/lib/nightly/messages";
import { SupportNote } from "./NightlyNotes";

/** Shows the General Help route in the locale already delivered by the root layout. */
export function DiscordHelpNote() {
    const { t, rich } = useTranslations("common");
    return <SupportNote title={t("nightly.support.title")}>
        {rich("nightly.support.includeMessage", discordSupportSlots(t))}
    </SupportNote>;
}

/** Gives inline generic failures the same ticket route without changing other messages. */
export function NightlyErrorText({ message }: { message: string }) {
    const { t, rich } = useTranslations("common");
    return <>{message}{message === GENERIC_ERROR_MESSAGE && <> {rich("nightly.support.ticket", discordSupportSlots(t))}</>}</>;
}
