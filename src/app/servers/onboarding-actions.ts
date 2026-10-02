"use server";

import { getTranslations } from "@/app/lib/localization/server";
import { MyServersApiError, requestServerOnboarding } from "@/app/lib/hosting/my-servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { parseOnboardingIntent, type OnboardingResult } from "../../../supabase/functions/_shared/server-onboarding-contract";
import { revalidatePath } from "next/cache";

export type OnboardingActionResult =
    | { ok: true; result: OnboardingResult }
    | { ok: false; message: string; retrySameRequest: boolean };

/** Authenticates and submits the retained exact request, localizing only outcome guidance. */
export async function submitServerOnboarding(input: unknown, expectedPageUserId: unknown): Promise<OnboardingActionResult> {
    const { t } = await getTranslations("servers");
    let intent;
    try { intent = parseOnboardingIntent(input); } catch {
        return uncertain(t("action.invalid"));
    }
    let accessToken: string | null;
    try {
        const supabase = await getSupabaseServerClient();
        const [{ data: userData }, { data: sessionData }] = await Promise.all([
            supabase.auth.getUser(), supabase.auth.getSession(),
        ]);
        // Only narrows dispatch. The current verified JWT and backend account binding
        // remain the sole source of authority, not this page-supplied account ID.
        if (!userData.user || typeof expectedPageUserId !== "string" || expectedPageUserId !== userData.user.id) {
            return uncertain(t("action.accountMismatch"));
        }
        accessToken = sessionData.session?.access_token ?? null;
    } catch {
        return uncertain(t("action.sessionUnavailable"));
    }
    if (!accessToken) return uncertain(t("action.signIn"));
    try {
        const result = await requestServerOnboarding(accessToken, intent);
        revalidatePath("/servers");
        return { ok: true, result };
    } catch (error) {
        const code = error instanceof MyServersApiError ? error.code : "operation_failed";
        // These workflow errors occur only AFTER exact receipt lookup. Auth failures,
        // request_conflict and rate_limited do not establish a previous attempt's outcome.
        if (["capacity_unavailable", "capacity_available", "quota_exhausted", "provider_cannot_assign",
            "required_approval_missing", "pilot_only", "provisioning_paused", "validated_build_unavailable"].includes(code)) {
            revalidatePath("/servers");
            return { ok: false, retrySameRequest: false, message: t("action.noChange") };
        }
        return uncertain(t("action.unconfirmed"));
    }
}
/** Retains ambiguous requests for safe exact replay. */
function uncertain(message: string): OnboardingActionResult { return { ok: false, retrySameRequest: true, message }; }
