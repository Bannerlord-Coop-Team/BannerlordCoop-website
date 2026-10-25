/** Path-scoped cookie the cheats page reads to omit a dismissed hosting offer from the server render. */
export const HOSTING_OFFER_COOKIE = "blcoop-hosting-offer";

const HIDDEN = "hidden";
const HIDDEN_SECONDS = 60 * 60 * 24 * 30;

/** Treats only the exact marker as dismissed, so absent or unrelated values keep the offer. */
export function isHostingOfferHidden(value: string | undefined) {
    return value === HIDDEN;
}

/** Remembers a dismissal in this browser for 30 days; only /cheats requests carry the cookie. */
export function rememberHostingOfferHidden() {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${HOSTING_OFFER_COOKIE}=${HIDDEN}; Path=/cheats; Max-Age=${HIDDEN_SECONDS}; SameSite=Lax${secure}`;
}
