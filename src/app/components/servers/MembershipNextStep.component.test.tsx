import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MembershipNextStep } from "./MembershipNextStep";
import { composeOnboarding, EMPTY_MEMBERSHIP } from "@/app/lib/hosting/membership-onboarding";
vi.mock("@/app/account/actions", () => ({ linkDiscordAccount: vi.fn(), linkPatreonAccount: vi.fn() }));
it("pending verification navigates back to account confirmation without OAuth or cookie mutation", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    // Synthetic navigation/cookie sentinel, not a real HttpOnly Auth browser proof.
    document.cookie = "pending-confirmation=unchanged; Path=/";
    const summary = composeOnboarding("aaaaaaaa-1111-4111-8111-111111111111", null, { version: 1, accountId: "aaaaaaaa-1111-4111-8111-111111111111", hasDiscord: true, configured: true, verificationPending: true, membership: EMPTY_MEMBERSHIP }, null);
    try {
        await act(async () => root.render(<MembershipNextStep summary={summary} />));
        const link = Array.from(container.querySelectorAll("a")).find(a => a.textContent === "Return to account confirmation");
        expect(link?.getAttribute("href")).toBe("/account");
        expect(container.querySelector("form")).toBeNull();
        expect(container.textContent).not.toContain("Refresh status");
        expect(document.cookie).toContain("pending-confirmation=unchanged");
    } finally { await act(async () => root.unmount()); container.remove(); document.cookie = "pending-confirmation=; Max-Age=0; Path=/"; }
});
