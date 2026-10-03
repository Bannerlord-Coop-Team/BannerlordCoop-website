import { LocalizationProvider } from "@/app/lib/localization/client";
import servers from "@/app/lib/localization/dictionaries/en/servers.json";
import serverCommon from "@/app/lib/localization/dictionaries/en/server-common.json";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MembershipNextStep } from "./MembershipNextStep";
import { renderToStaticMarkup } from "react-dom/server";
import { composeOnboarding, EMPTY_MEMBERSHIP, type WebsiteOnboardingSummary } from "@/app/lib/hosting/membership-onboarding";
vi.mock("@/app/account/actions", () => ({ linkDiscordAccount: vi.fn(), linkPatreonAccount: vi.fn() }));

it("resolves every membership status from dictionary data and preserves the Patreon return path", () => {
    const summary = composeOnboarding(null, null, null, null);
    const statuses: WebsiteOnboardingSummary["status"][] = ["signed_out", "identity_repair", "configuration_blocked", "needs_patreon", "verification_pending", "sync_pending", "nonqualifying", "verification_expired", "review_required", "unavailable", "eligible", "quota_exhausted", "provisioning_unavailable", "created"];
    for (const status of statuses) {
        const dictionary = { ...servers, [`membership.status.${status}`]: `Localized status: ${status}`, "membership.connect": "Authorize membership", "membership.label": "Localized next step" };
        const html = renderToStaticMarkup(<LocalizationProvider locale="en" messages={{ servers: dictionary }}><MembershipNextStep summary={{ ...summary, status, nextAction: "connect_patreon" }} /></LocalizationProvider>);
        expect(html).toContain(`Localized status: ${status}`);
        expect(html).toContain('aria-label="Localized next step"');
        expect(html).toContain("Authorize membership");
        expect(html).toContain('name="returnPath" value="/servers"');
    }
});
it("pending verification navigates back to account confirmation without OAuth or cookie mutation", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    // Synthetic navigation/cookie sentinel, not a real HttpOnly Auth browser proof.
    document.cookie = "pending-confirmation=unchanged; Path=/";
    const summary = composeOnboarding("aaaaaaaa-1111-4111-8111-111111111111", null, { version: 1, accountId: "aaaaaaaa-1111-4111-8111-111111111111", hasDiscord: true, configured: true, verificationPending: true, membership: EMPTY_MEMBERSHIP }, null);
    try {
        await act(async () => root.render(<LocalizationProvider locale="en" messages={{ servers }}><MembershipNextStep summary={summary} /></LocalizationProvider>));
        const link = Array.from(container.querySelectorAll("a")).find(a => a.textContent === "Return to account confirmation");
        expect(link?.getAttribute("href")).toBe("/account");
        expect(container.querySelector("form")).toBeNull();
        expect(container.textContent).not.toContain("Refresh status");
        expect(document.cookie).toContain("pending-confirmation=unchanged");
    } finally { await act(async () => root.unmount()); container.remove(); document.cookie = "pending-confirmation=; Max-Age=0; Path=/"; }
});
