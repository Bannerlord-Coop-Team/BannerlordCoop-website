"use server";

import { getTranslations } from "@/app/lib/localization/server";

import {
    getMyServerBackupStatus,
    MyServersApiError,
    requestMyServerOperation,
    requestMyServerUpdate,
    requestMyServerPassword,
    type MyServerOperation,
} from "@/app/lib/hosting/my-servers";
import { getMyServerStartStatus } from "@/app/lib/hosting/my-servers-server";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { revalidatePath } from "next/cache";

const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OPERATIONS = new Set<MyServerOperation>(["start", "stop", "restart-game"]);

/** `checkStatus` asks the page to follow server status; `refresh` asks it to reload status once. */
export type ManagedServerActionResult = { ok: boolean; message: string; operationId?: string; checkStatus?: boolean; refresh?: boolean };

// Authenticates and submits lifecycle operations with localized result presentation.
export async function operateManagedServer(input: unknown): Promise<ManagedServerActionResult> {
    const { t } = await getTranslations("managed-server");
    const parsed = parseOperation(input);
    if (parsed === null) return { ok: false, message: t("action.actions.theServerOperationIsInvalid") };

    let accessToken: string | null = null;
    try {
        const supabase = await getSupabaseServerClient();
        const [{ data: userData }, { data: sessionData }] = await Promise.all([
            supabase.auth.getUser(),
            supabase.auth.getSession(),
        ]);
        if (userData.user === null) {
            return { ok: false, message: t("action.actions.pleaseSignInAgainBeforeControllingThisServer") };
        }
        accessToken = sessionData.session?.access_token ?? null;
    } catch {
        return { ok: false, message: t("action.actions.yourAuthenticatedServerSessionIsUnavailable") };
    }
    if (accessToken === null) {
        return { ok: false, message: t("action.actions.pleaseSignInAgainBeforeControllingThisServer") };
    }

    try {
        if (parsed.action === "update-now") {
            const update = await requestMyServerUpdate(accessToken, {
                serverId: parsed.serverId,
                expectedUpdatedAt: parsed.expectedUpdatedAt,
            }, crypto.randomUUID());
            revalidatePath("/servers");
            return { ok: true, message: update.outcome === "existing"
                ? t("action.actions.anUpdateIsAlreadyQueuedForThisServer")
                : t("action.actions.updateQueuedABackupWillBeTakenBeforeTheSelected") };
        } else {
            await requestMyServerOperation(accessToken, parsed);
        }
        revalidatePath("/servers");
        if (parsed.action === "start") return { ok: true, message: t("action.actions.serverStartedAndGameReadinessConfirmed") };
        if (parsed.action === "stop") return { ok: true, checkStatus: true, message: t("controls.checkingWhetherYourServerHasStopped") };
        return { ok: true, message: t("controls.restartingPlayersCanRejoinOnceTheCampaignFinishesLoadingUsually") };
    } catch (error) {
        revalidatePath("/servers");
        const code = error instanceof MyServersApiError ? error.code : "operation_failed";
        if (code === "server_not_found") {
            return { ok: false, message: t("action.actions.thisServerIsUnavailableOrYourAccessWasRemoved") };
        }
        if (code === "container_command_failed" && error instanceof MyServersApiError) {
            return { ok: false, message: error.message };
        }
        if (parsed.action === "start" && code === "operation_timeout"
            && error instanceof MyServersApiError && error.operationId !== undefined) {
            return { ok: true, operationId: error.operationId, message: t("action.actions.startAcceptedFollowingYourServerSProgress") };
        }
        if (parsed.action === "update-now") {
            if (code === "stale_interaction") {
                return { ok: false, refresh: true, message: t("action.actions.yourServerSStatusChangedSoWeRefreshedItPress", { action: t("controls.updateNow") }) };
            }
            if (code === "no_update_available") {
                return { ok: false, message: t("action.actions.thisServerAlreadyHasItsSelectedRelease") };
            }
            if (code === "validated_build_unavailable") {
                return { ok: false, message: t("action.actions.noValidatedReleaseIsCurrentlyAvailableForThisServer") };
            }
        }
        if (parsed.action === "stop") return { ok: false, checkStatus: true, message: t("controls.checkingWhetherYourServerHasStopped") };
        return { ok: false, checkStatus: true, message: t("controls.weCouldnTConfirmThatYourOperationRequestWentThrough", { operation: operationLabel(parsed.action, t) }) };
    }
}

// Validates the existing lifecycle request without changing accepted inputs.
function parseOperation(value: unknown): {
    serverId: string;
    action: MyServerOperation;
} | {
    serverId: string;
    action: "update-now";
    expectedUpdatedAt: string;
} | null {
    if (!isRecord(value) || typeof value.action !== "string") return null;
    if (typeof value.serverId !== "string" || !SERVER_ID.test(value.serverId)) return null;
    if (value.action === "update-now") {
        if (!hasExactKeys(value, ["action", "expectedUpdatedAt", "serverId"])) return null;
        if (typeof value.expectedUpdatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.expectedUpdatedAt)) return null;
        return { serverId: value.serverId, action: value.action, expectedUpdatedAt: value.expectedUpdatedAt };
    }
    if (!hasExactKeys(value, ["action", "serverId"])) return null;
    if (typeof value.action !== "string" || !OPERATIONS.has(value.action as MyServerOperation)) return null;
    return {
        serverId: value.serverId,
        action: value.action as MyServerOperation,
    };
}

// Resolves the localized label for an unchanged operation code.
function operationLabel(action: MyServerOperation | "update-now", t: (key: string) => string) {
    switch (action) {
        case "start": return t("operation.start");
        case "stop": return t("operation.stop");
        case "restart-game": return t("operation.restart");
        case "update-now": return t("controls.updateNow");
    }
}

// Checks the existing request shape without changing its accepted keys.
function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
    const keys = Object.keys(value).sort();
    return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

// Recognizes plain request objects for existing validation.
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Authenticates password changes and localizes the existing result.
export async function setManagedServerPassword(input: { serverId: string; expectedUpdatedAt: string; password: string }): Promise<ManagedServerActionResult> {
    const { t } = await getTranslations("managed-server");
    if (!input || !SERVER_ID.test(input.serverId) || typeof input.password !== "string" || input.password.length < 1 || input.password.length > 128 || typeof input.expectedUpdatedAt !== "string") return { ok: false, message: t("action.actions.enterAPasswordOf1128Characters") };
    try {
        const supabase = await getSupabaseServerClient();
        const [{ data: { user } }, { data: { session } }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
        if (!user || !session) return { ok: false, message: t("action.actions.signInAgainToChangeThePassword") };
        const result = await requestMyServerPassword(session.access_token, input, crypto.randomUUID());
        revalidatePath(`/servers/${input.serverId}`);
        return { ok: true, message: result.restartQueued ? t("action.actions.passwordChangedARestartIsQueuedWithAPlayerWarning") : t("action.actions.passwordChangedUseItWhenJoiningYourServer") };
    } catch {
        return { ok: false, checkStatus: true, message: t("controls.weCouldnTConfirmThePasswordChangeSoWeRefreshed") };
    }
}

/** Reauthenticates each progress read; the control plane checks current server access. */
export async function readManagedServerStartStatus(serverId: string, jobId: string) {
    const { t } = await getTranslations("managed-server");
    if (typeof serverId !== "string" || typeof jobId !== "string" || !SERVER_ID.test(serverId) || !SERVER_ID.test(jobId)) {
        return { ok: false as const, retryable: false, message: t("action.actions.theStartReferenceIsInvalid") };
    }
    try {
        const supabase = await getSupabaseServerClient();
        const [{ data: { user } }, { data: { session } }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
        if (!user || !session) return { ok: false as const, retryable: false, message: t("action.actions.signInAgainToFollowServerProgress") };
        return { ok: true as const, status: await getMyServerStartStatus(session.access_token, serverId, jobId) };
    } catch (error) {
        if (error instanceof MyServersApiError && ["forbidden", "server_not_found", "unauthenticated"].includes(error.code)) {
            return { ok: false as const, retryable: false, message: t("action.actions.yourServerAccessCouldNotBeConfirmedSignInAgain") };
        }
        return { ok: false as const, retryable: true, message: t("action.actions.reconnectingToServerProgressYourStartRequestIsStillBeing") };
    }
}

/**
 * Reads only the compact status that lifecycle and backup polling watch. Polling re-renders the
 * page only when this fingerprint changes, keeping repeated checks far cheaper than full renders.
 */
export async function readManagedServerStatusFingerprint(serverId: string): Promise<{ ok: true; fingerprint: string } | { ok: false }> {
    if (typeof serverId !== "string" || !SERVER_ID.test(serverId)) return { ok: false };
    try {
        const supabase = await getSupabaseServerClient();
        const [{ data: { user } }, { data: { session } }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
        if (!user || !session) return { ok: false };
        const status = await getMyServerBackupStatus(session.access_token, serverId);
        const job = status.job;
        return { ok: true, fingerprint: JSON.stringify([status.updatedAt, status.operationState, status.observedGameState,
            job?.jobId ?? null, job?.state ?? null, job?.progress ?? null]) };
    } catch {
        return { ok: false };
    }
}
