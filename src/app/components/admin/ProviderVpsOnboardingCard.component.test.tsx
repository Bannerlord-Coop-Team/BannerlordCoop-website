import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProviderVpsOnboardingCard, providerAccountNotice, providerAccountUnavailableReason } from "./ProviderVpsOnboardingCard";
import type { HostingAdminVpsAvailableHost } from "@/app/lib/control-plane/types";
import type { BillingReadState } from "@/app/lib/control-plane/vps-billing-state";

const { request, session, refresh, push } = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/app/lib/control-plane/client", async (importOriginal) => ({
    ...await importOriginal<typeof import("@/app/lib/control-plane/client")>(), requestControlPlaneAdmin: request,
}));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: session } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));

const CONTABO: HostingAdminVpsAvailableHost = { provider: "contabo-vps", serviceName: "203779521", label: "Contabo VPS · 203779521" };
const OVH: HostingAdminVpsAvailableHost = { provider: "ovhcloud-vps", serviceName: "vps-available.vps.ovh.us", label: "OVHcloud VPS · vps-available.vps.ovh.us" };
const LOADED: BillingReadState = { kind: "ok", availableHosts: [CONTABO] };
const PENDING: BillingReadState = { kind: "loading" };
const UNLISTED: BillingReadState = { kind: "failed", error: "Billing readings timed out." };
const STALE: BillingReadState = { kind: "stale", error: "Billing readings timed out.", availableHosts: [CONTABO] };
const PARTIAL: BillingReadState = { kind: "partial", failedProviderReads: "The Contabo account read failed.", availableHosts: [CONTABO] };

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    session.mockResolvedValue({ data: { session: { access_token: "test-only" } } });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

/** Renders the card over the given billing state. */
async function render(state: BillingReadState) {
    await act(async () => root.render(<ProviderVpsOnboardingCard state={state} onRetry={vi.fn()} />));
}

/** The host select and the submit button. */
function hostSelect() { return container.querySelector<HTMLSelectElement>('select[name="host"]')!; }
function submitButton() { return container.querySelector<HTMLButtonElement>('button[type="submit"]')!; }

it("onboards the only listed VPS with its provider and keeps the result visible after refreshing in place", async () => {
    request.mockResolvedValueOnce({ onboarding: { state: "queued", progressStage: "queued" } });
    await render(LOADED);
    // A single listed VPS is preselected; its value carries the provider so onboarding never guesses it.
    expect(hostSelect().value).toBe(JSON.stringify({ provider: "contabo-vps", serviceName: "203779521" }));
    await act(async () => container.querySelector("form")!.requestSubmit());
    expect(request.mock.calls[0]?.[0]).toMatchObject({ operation: "onboard-vps-host", input: { provider: "contabo-vps", serviceName: "203779521", mode: "enroll" } });
    expect(request.mock.calls[0]?.[0].input).not.toHaveProperty("host");
    expect(refresh).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
    expect(container.textContent).toContain("VPS onboarding queued: queued.");
    // A later billing reading that no longer lists the host keeps the card, and its result, mounted.
    await render({ kind: "ok", availableHosts: [] });
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
    await render({ kind: "ok", availableHosts: [CONTABO, OVH] });
    expect([...hostSelect().options].map((option) => option.textContent)).toEqual(["Select…", CONTABO.label, OVH.label]);
    expect(hostSelect().value).toBe("");
});

it("blocks submission only while no hosts are listed, naming whether the read is loading or failed", () => {
    for (const listed of [LOADED, STALE, PARTIAL]) expect(providerAccountUnavailableReason(listed)).toBeUndefined();
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
