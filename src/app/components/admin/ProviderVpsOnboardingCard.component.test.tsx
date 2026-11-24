import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    ProviderVpsOnboardingCard,
    providerAccountInventory,
    providerAccountNotice,
    providerAccountUnavailableReason,
    type ProviderAccountInventory,
} from "./ProviderVpsOnboardingCard";
import type { HostingAdminVpsAvailableHost, HostingAdminVpsInventory } from "@/app/lib/control-plane/types";

const { request, session, refresh, push } = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/app/lib/control-plane/client", async (importOriginal) => ({
    ...await importOriginal<typeof import("@/app/lib/control-plane/client")>(), requestControlPlaneAdmin: request,
}));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: session } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));

const CONTABO: HostingAdminVpsAvailableHost = { provider: "contabo-vps", serviceName: "203779521", label: "Contabo VPS · 203779521" };
const OVH: HostingAdminVpsAvailableHost = { provider: "ovhcloud-vps", serviceName: "vps-available.vps.ovh.us", label: "OVHcloud VPS · vps-available.vps.ovh.us" };
const LOADED: ProviderAccountInventory = { availableHosts: [CONTABO], pending: false, error: null, failedProviderReads: null };
const PENDING: ProviderAccountInventory = { availableHosts: null, pending: true, error: null, failedProviderReads: null };

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    session.mockResolvedValue({ data: { session: { access_token: "test-only" } } });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

/** Renders the card over the given inventory, with an optional retry handler. */
async function render(inventory: ProviderAccountInventory, onRetry = vi.fn()) {
    await act(async () => root.render(<ProviderVpsOnboardingCard inventory={inventory} onRetry={onRetry} />));
}

/** The notice's retry button, if shown. */
function retryButton() {
    return [...container.querySelectorAll("button")].find((button) => button.textContent === "Retry provider inventory");
}

/** The host select and the submit button. */
function hostSelect() { return container.querySelector<HTMLSelectElement>('select[name="host"]')!; }
function submitButton() { return container.querySelector<HTMLButtonElement>('button[type="submit"]')!; }

it("onboards the only listed VPS with its provider and keeps the result visible after refreshing in place", async () => {
    request.mockResolvedValueOnce({ onboarding: { state: "queued", progressStage: "queued" } });
    await render(LOADED);
    expect(container.textContent).toContain("Onboard provider-account VPS");
    expect(container.textContent).toContain("For OVHcloud and Contabo");
    // A single listed VPS is preselected; its value carries the provider so onboarding never guesses it.
    expect(hostSelect().value).toBe(JSON.stringify({ provider: "contabo-vps", serviceName: "203779521" }));
    await act(async () => container.querySelector("form")!.requestSubmit());
    expect(request.mock.calls[0]?.[0]).toMatchObject({ operation: "onboard-vps-host", input: { provider: "contabo-vps", serviceName: "203779521", mode: "enroll" } });
    expect(refresh).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
    expect(container.textContent).toContain("VPS onboarding queued: queued.");
    // A later billing reading that no longer lists the host keeps the card, and its result, mounted.
    await render({ ...LOADED, availableHosts: [] });
    expect(container.textContent).toContain("VPS onboarding queued: queued.");
});

it("disables submit while the inventory loads, then preselects the only VPS once it arrives", async () => {
    await render(PENDING);
    expect(container.textContent).toContain("Loading provider account inventory…");
    expect(submitButton().disabled).toBe(true);
    await render(LOADED);
    expect(container.textContent).not.toContain("Loading provider account inventory");
    expect(hostSelect().value).toContain("203779521");
    expect(submitButton().textContent).toBe("Onboard VPS");
});

it("lists several VPSes without preselecting one", async () => {
    await render({ ...LOADED, availableHosts: [CONTABO, OVH] });
    expect([...hostSelect().options].map((option) => option.textContent)).toEqual(["Select…", CONTABO.label, OVH.label]);
    expect(hostSelect().value).toBe("");
});

it.each([
    ["an unlisted inventory", { availableHosts: null, pending: false, error: "Billing readings timed out.", failedProviderReads: null }],
    ["a failed later read", { ...LOADED, error: "Billing readings timed out." }],
] as Array<[string, ProviderAccountInventory]>)("offers a retry from the notice for %s", async (_name, inventory) => {
    const onRetry = vi.fn();
    await render(inventory, onRetry);
    await act(async () => retryButton()!.click());
    expect(onRetry).toHaveBeenCalledOnce();
});

it("blocks submission only while no hosts are listed, naming whether the read is loading or failed", () => {
    expect(providerAccountUnavailableReason(LOADED)).toBeUndefined();
    expect(providerAccountUnavailableReason({ ...LOADED, availableHosts: [] })).toBeUndefined();
    expect(providerAccountUnavailableReason(PENDING)).toBe("Loading provider account inventory…");
    expect(providerAccountUnavailableReason({ ...PENDING, pending: false, error: "Down." })).toBe("Provider account inventory is unavailable.");
});

it("notices a failed read before a retained listing before failed provider accounts, and stays silent when complete", () => {
    expect(providerAccountNotice(LOADED)).toBeNull();
    expect(providerAccountNotice(PENDING)).toBeNull();
    expect(providerAccountNotice({ availableHosts: null, pending: false, error: "Down.", failedProviderReads: null })?.detail).toBe("Down.");
    expect(providerAccountNotice({ ...LOADED, error: "Billing readings timed out.", failedProviderReads: "The Contabo account read failed." }))
        .toEqual({ summary: "Showing the last provider account inventory; retrying automatically.", detail: "Billing readings timed out.", retryable: true });
    expect(providerAccountNotice({ ...LOADED, failedProviderReads: "The Contabo account read failed." }))
        .toEqual({ summary: "The Contabo account read failed.", detail: "Manual entry still works.", retryable: false });
});

it("maps a billing reading onto the form's inventory, passing failed provider reads through", () => {
    const listed = { availableHosts: [CONTABO] } as HostingAdminVpsInventory;
    expect(providerAccountInventory({ pending: true }, null)).toEqual(PENDING);
    expect(providerAccountInventory({ result: listed, error: "Timed out.", pending: false }, "The Contabo account read failed.")).toEqual({
        availableHosts: [CONTABO], pending: false, error: "Timed out.", failedProviderReads: "The Contabo account read failed.",
    });
    expect(providerAccountInventory({ error: "Timed out.", pending: false }, null)).toEqual({ availableHosts: null, pending: false, error: "Timed out.", failedProviderReads: null });
});

it("treats a malformed host list as not yet listed", () => {
    const malformed = { availableHosts: "not-a-list" } as unknown as HostingAdminVpsInventory;
    expect(providerAccountInventory({ result: malformed, pending: false }, null)).toEqual({
        availableHosts: null, pending: false, error: "The provider account inventory response did not list hosts.", failedProviderReads: null,
    });
});
