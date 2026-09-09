"use server";

import { MyServersApiError, requestServerOnboarding } from "@/app/lib/hosting/my-servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { parseOnboardingIntent, type OnboardingResult } from "../../../supabase/functions/_shared/server-onboarding-contract";
import { revalidatePath } from "next/cache";

export type OnboardingActionResult =
    | { ok: true; result: OnboardingResult }
    | { ok: false; message: string; retrySameRequest: boolean };

export async function submitServerOnboarding(input: unknown, expectedPageUserId: unknown): Promise<OnboardingActionResult> {
    let intent;
    try { intent = parseOnboardingIntent(input); } catch {
        return uncertain("The retained request is invalid. Do not submit a replacement until its outcome is reconciled.");
    }
    let accessToken: string | null;
    try {
        const supabase = await getSupabaseServerClient();
        const [{ data: userData }, { data: sessionData }] = await Promise.all([
            supabase.auth.getUser(), supabase.auth.getSession(),
        ]);
        // Only narrows dispatch. The current verified JWT and backend Discord linkage
        // remain the sole source of authority, not this page-supplied account ID.
        if (!userData.user || typeof expectedPageUserId !== "string" || expectedPageUserId !== userData.user.id) {
            return uncertain("Sign in with the account that submitted this request, then retry the pending request.");
        }
        accessToken = sessionData.session?.access_token ?? null;
    } catch {
        return uncertain("Your authenticated session is unavailable. Sign in again, then retry the pending request.");
    }
    if (!accessToken) return uncertain("Sign in again, then retry the pending request.");
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
            return { ok: false, retrySameRequest: false, message: "No change was made by this request. Capacity or eligibility changed; refresh before choosing again." };
        }
        return uncertain("The submission outcome is unconfirmed. Wait if rate limited, then retry the same pending request to avoid duplicates.");
    }
}
function uncertain(message: string): OnboardingActionResult { return { ok: false, retrySameRequest: true, message }; }
