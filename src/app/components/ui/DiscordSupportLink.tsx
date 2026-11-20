import { Fragment } from "react";
import { DISCORD_SUPPORT_URL } from "../../../../supabase/functions/_shared/discord-support";
import type { RichSlots, Translator } from "@/app/lib/localization/types";

function DiscordSupportLink({ label }: { label: string }) {
    return <a href={DISCORD_SUPPORT_URL} target="_blank" rel="noopener noreferrer" className="text-gold underline hover:text-gold/85">{label}</a>;
}

export function discordSupportSlots(t: Translator["t"], slots: RichSlots = {}): RichSlots {
    return { ...slots, supportLink: <DiscordSupportLink label={t("support.discord")} /> };
}

/** Renders the fixed invite in string-only action results and hosting messages. */
export function DiscordSupportText({ message, label = "our Discord" }: { message: string; label?: string }) {
    const parts = message.replaceAll("our Discord (" + DISCORD_SUPPORT_URL + ")", DISCORD_SUPPORT_URL).split(DISCORD_SUPPORT_URL);
    return parts.map((part, index) => <Fragment key={index}>
        {index > 0 && <DiscordSupportLink label={label} />}{part}
    </Fragment>);
}
