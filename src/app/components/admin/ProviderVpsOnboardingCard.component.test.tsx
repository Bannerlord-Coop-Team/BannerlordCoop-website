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
const LOADED: ProviderAccountInventory = { availableHosts: [CONTABO], readState: { kind: "ok" } };
const PENDING: ProviderAccountInventory = { availableHosts: null, readState: { kind: "loading" } };
const UNLISTED: ProviderAccountInventory = { availableHosts: null, readState: { kind: "failed", error: "Billing readings timed out." } };
const STALE: ProviderAccountInventory = { availableHosts: [CONTABO], readState: { kind: "stale", error: "Billing readings timed out." } };
const PARTIAL: ProviderAccountInventory = { availableHosts: [CONTABO], readState: { kind: "partial", failedProviderReads: "The Contabo account read failed." } };

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
    expect(request.mock.calls[0]?.[0].input).not.toHaveProperty("host");
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
    ["an unlisted inventory", UNLISTED],
    ["a failed later read", STALE],
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
    expect(providerAccountUnavailableReason(UNLISTED)).toBe("Provider account inventory is unavailable.");
});

it("builds one notice per read state and stays silent while loading or complete", () => {
    expect(providerAccountNotice(LOADED)).toBeNull();
    expect(providerAccountNotice(PENDING)).toBeNull();
    expect(providerAccountNotice(UNLISTED)).toEqual({ summary: expect.stringContaining("Provider account inventory is unavailable"), detail: "Billing readings timed out.", retryable: true });
    expect(providerAccountNotice(STALE)).toEqual({ summary: "Showing the last provider account inventory; retrying automatically.", detail: "Billing readings timed out.", retryable: true });
    expect(providerAccountNotice(PARTIAL)).toEqual({ summary: "The Contabo account read failed.", detail: "Manual entry still works.", retryable: false });
});

it("maps a billing reading onto the form's inventory with its read state", () => {
    const listed = { availableHosts: [CONTABO] } as HostingAdminVpsInventory;
    const partial = { availableHosts: [CONTABO], providerReads: [{ provider: "contabo-vps", status: "failed", code: null }] } as HostingAdminVpsInventory;
    expect(providerAccountInventory({ pending: true })).toEqual(PENDING);
    expect(providerAccountInventory({ result: listed, error: "Timed out.", pending: false })).toEqual({ availableHosts: [CONTABO], readState: { kind: "stale", error: "Timed out." } });
    expect(providerAccountInventory({ result: partial, pending: false }).readState.kind).toBe("partial");
    expect(providerAccountInventory({ error: "Timed out.", pending: false })).toEqual({ availableHosts: null, readState: { kind: "failed", error: "Timed out." } });
});

it("treats a malformed host list as not yet listed", () => {
    const malformed = { availableHosts: "not-a-list" } as unknown as HostingAdminVpsInventory;
    expect(providerAccountInventory({ result: malformed, pending: false })).toEqual({
        availableHosts: null, readState: { kind: "failed", error: "The provider account inventory response did not list hosts." },
    });
});
