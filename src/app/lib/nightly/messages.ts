import { QUALIFYING_ROLES_TEXT, SPONSORED_ACCOUNT_LIMIT } from "../../../../supabase/functions/_shared/nightly/policy";

/** Every step an Edge Function error can surface in; the same code can need different wording per step. */
export const NIGHTLY_ERROR_CONTEXTS = [
    "activate", "callback", "claim", "sponsor-login", "sponsor-code", "sponsor-remove",
] as const;

/** Where an Edge Function error surfaced. */
export type NightlyErrorContext = (typeof NIGHTLY_ERROR_CONTEXTS)[number];

/** Optional help panel shown under an error message. */
export type NightlyErrorHelp = "sponsor-code" | null;

/** The canned message and optional help panel the error page renders. */
export type NightlyErrorView = { message: string; help: NightlyErrorHelp };

export const GENERIC_ERROR_MESSAGE = "Access could not be verified. Run the installer again or ask in the Bannerlord Co-op Discord.";
export const ROLE_REQUIRED_MESSAGE = `A ${QUALIFYING_ROLES_TEXT} role is required.`;
export const INSTALLER_AUTHORIZATION_EXPIRED_MESSAGE = "That installer authorization has expired.";

// Copy was carried over from the former Worker pages so users see the same wording.
const CONTEXT_MESSAGES: Record<NightlyErrorContext, Readonly<Record<string, string>>> = {
    activate: {
        invalid_code: "That installer code is invalid.",
        expired: "That installer code has expired.",
    },
    callback: {
        invalid_request: "Discord sign-in could not be verified.",
        expired: INSTALLER_AUTHORIZATION_EXPIRED_MESSAGE,
        supporter_role_required: ROLE_REQUIRED_MESSAGE,
    },
    claim: {
        expired: INSTALLER_AUTHORIZATION_EXPIRED_MESSAGE,
        invalid_sponsor_code: "That sponsor code is not valid.",
        supporter_role_required: `That sponsor no longer has a qualifying ${QUALIFYING_ROLES_TEXT} role.`,
        already_sponsored: "This Discord account already has sponsored access.",
        seats_full: `That eligible member has already used all ${SPONSORED_ACCOUNT_LIMIT} sponsored-account seats.`,
    },
    "sponsor-login": {},
    "sponsor-code": {},
    "sponsor-remove": {
        invalid_request: "That sponsored account could not be removed. Reload the page and try again.",
    },
};

/** Maps an Edge Function error code to user-facing copy; unknown codes get the gateway's generic message. */
export function nightlyErrorMessage(context: NightlyErrorContext, code: string): string {
    return own(CONTEXT_MESSAGES[context], code) ?? GENERIC_ERROR_MESSAGE;
}

/** Resolves the full error view, adding the sponsor-code help where the gateway showed it; no context reads as generic. */
export function nightlyErrorView(context: NightlyErrorContext | null, code: string): NightlyErrorView {
    if (context === null) return { message: GENERIC_ERROR_MESSAGE, help: null };
    const help: NightlyErrorHelp = context === "callback" && code === "supporter_role_required" ? "sponsor-code" : null;
    return { message: nightlyErrorMessage(context, code), help };
}

/** Reads an own property only, so codes like `constructor` never resolve to prototype members. */
function own(table: Readonly<Record<string, string>>, key: string): string | undefined {
    return Object.hasOwn(table, key) ? table[key] : undefined;
}
