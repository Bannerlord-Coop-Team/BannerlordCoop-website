import { SPONSORED_ACCOUNT_LIMIT } from "../../../../supabase/functions/_shared/nightly/policy";

/** Where an Edge Function error surfaced; the same code can need different wording per step. */
export type NightlyErrorContext = "activate" | "callback" | "claim" | "sponsor-login" | "sponsor-code" | "sponsor-remove";

/** Optional help panel shown under an error message. */
export type NightlyErrorHelp = "sponsor-code" | null;

export type NightlyErrorView = { message: string; help: NightlyErrorHelp };

export const NIGHTLY_ERROR_CONTEXTS: readonly NightlyErrorContext[] = [
    "activate", "callback", "claim", "sponsor-login", "sponsor-code", "sponsor-remove",
];

/** The Discord roles that qualify for nightly access, as every nightly page spells them. */
export const QUALIFYING_ROLES_TEXT = "Staff, Tester, Patreon, Boosty, or Afdian";
export const GENERIC_ERROR_MESSAGE = "Access could not be verified. Run the installer again or ask in the Bannerlord Co-op Discord.";
export const ROLE_REQUIRED_MESSAGE = `A ${QUALIFYING_ROLES_TEXT} role is required.`;
export const INSTALLER_AUTHORIZATION_EXPIRED_MESSAGE = "That installer authorization has expired.";

// Copy comes from the retired Worker pages (nightly-gateway/src/index.ts) so users see the same wording.
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
    "sponsor-code": {
        supporter_role_required: ROLE_REQUIRED_MESSAGE,
    },
    "sponsor-remove": {
        invalid_request: "That sponsored account could not be removed. Reload the page and try again.",
        http_400: "That sponsored account could not be removed. Reload the page and try again.",
        supporter_role_required: ROLE_REQUIRED_MESSAGE,
    },
};

/** Maps an Edge Function error code to user-facing copy; unknown codes get the gateway's generic message. */
export function nightlyErrorMessage(context: NightlyErrorContext, code: string): string {
    return own(CONTEXT_MESSAGES[context], code) ?? GENERIC_ERROR_MESSAGE;
}

/** Resolves the full error view, adding the sponsor-code help where the gateway showed it. */
export function nightlyErrorView(context: NightlyErrorContext, code: string): NightlyErrorView {
    const help: NightlyErrorHelp = context === "callback" && code === "supporter_role_required" ? "sponsor-code" : null;
    return { message: nightlyErrorMessage(context, code), help };
}

/** Narrows untrusted query input to a known error context. */
export function parseErrorContext(value: string | undefined): NightlyErrorContext | null {
    return NIGHTLY_ERROR_CONTEXTS.find((context) => context === value) ?? null;
}

/** Reads an own property only, so codes like `constructor` never resolve to prototype members. */
function own(table: Readonly<Record<string, string>>, key: string): string | undefined {
    return Object.hasOwn(table, key) ? table[key] : undefined;
}
