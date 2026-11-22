import type { Translator } from "@/app/lib/localization/types";
import { DISCORD_SUPPORT_URL } from "../../../../supabase/functions/_shared/discord-support";
import type { CampaignResetStatus } from "../../../../supabase/functions/_shared/server-campaign-contract";

/** Presents a validated status using the active locale. The v1 wire instruction is validated separately. */
export function campaignResetStatusMessage(status: CampaignResetStatus | null, t: Translator["t"]): string {
    if (status === null) return "The reset status is not available from the hosting service yet. Your request has not been submitted again.";
    if (status.state === "succeeded") return "Your fresh campaign is ready. Start the server when you want to play it.";
    if (status.errorCode === "agent_capability_unavailable") return t("campaigns.resetRunnerHelp", { supportLink: DISCORD_SUPPORT_URL });
    if (status.errorCode === "queue_timeout") return "The campaign reset expired before it could start. Refresh before requesting another reset.";
    if (status.state === "failed" || status.state === "cancelled") return t("campaigns.resetFailedHelp", { supportLink: DISCORD_SUPPORT_URL });
    return "Preparing your fresh campaign. This takes about a minute…";
}
