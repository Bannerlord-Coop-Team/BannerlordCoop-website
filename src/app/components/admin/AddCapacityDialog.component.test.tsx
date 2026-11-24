import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AddCapacityDialog, adjacentTab, providerAccountNotice, type AddCapacityTab, type ProviderAccountInventory } from "./AddCapacityDialog";
import type { HostingAdminVpsAvailableHost } from "@/app/lib/control-plane/types";
import { hostingRegionCatalogPayload, type HostingRegionPayload } from "../../../../supabase/functions/_shared/hosting-regions";

const { request, session, refresh, push } = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/app/lib/control-plane/client", async (importOriginal) => ({
    ...await importOriginal<typeof import("@/app/lib/control-plane/client")>(), requestControlPlaneAdmin: request,
}));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: session } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));

const CONTABO: HostingAdminVpsAvailableHost = { provider: "contabo-vps", serviceName: "203779521", label: "Contabo VPS · 203779521" };
const OVH: HostingAdminVpsAvailableHost = { provider: "ovhcloud-vps", serviceName: "vps-available.vps.ovh.us", label: "OVHcloud VPS · vps-available.vps.ovh.us" };
const REGIONS: HostingRegionPayload[] = hostingRegionCatalogPayload().filter((entry) => entry.region === "us-west" || entry.region === "us-east");
const PROVIDERS = [{ provider: "hosthatch-vps", displayName: "HostHatch VPS" }];
const LOADED: ProviderAccountInventory = { availableHosts: [CONTABO], pending: false, error: null, failedProviderReads: null };

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
    session.mockResolvedValue({ data: { session: { access_token: "test-only" } } });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

/** Renders the dialog with overridable data and handlers. */
async function render({ initialTab = "provider" as AddCapacityTab, providerAccount = LOADED, regions = REGIONS as HostingRegionPayload[] | null,
    regionsError = null as string | null, onClose = vi.fn(), returnFocusTo = undefined as React.RefObject<HTMLElement | null> | undefined } = {}) {
    await act(async () => root.render(<AddCapacityDialog initialTab={initialTab} providerAccount={providerAccount} manualProviders={PROVIDERS}
        regions={regions} regionsError={regionsError} onClose={onClose} returnFocusTo={returnFocusTo} />));
}

/** The tab or panel elements, in order. */
function tabs() { return [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]; }
function panels() { return [...container.querySelectorAll<HTMLElement>('[role="tabpanel"]')]; }

/** Presses a key on the currently focused tab. */
async function press(key: string) {
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
}

it("opens as a labelled modal on the requested tab with focus on that tab", async () => {
    await render({ initialTab: "manual" });
    const dialog = container.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Add capacity");
    expect(container.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("Onboarding source");
    expect(tabs().map((tab) => [tab.textContent, tab.getAttribute("aria-selected"), tab.tabIndex])).toEqual([
        ["Provider account", "false", -1], ["Manual entry", "true", 0],
    ]);
    expect(document.activeElement).toBe(tabs()[1]);
    const [provider, manual] = panels();
    expect(provider!.hidden).toBe(true);
    expect(manual!.hidden).toBe(false);
    expect(manual!.getAttribute("aria-labelledby")).toBe(tabs()[1]!.id);
    expect(tabs()[1]!.getAttribute("aria-controls")).toBe(manual!.id);
});

it("switches tabs by click and with arrow, Home and End keys, keeping both forms mounted", async () => {
    await render();
    expect(document.activeElement).toBe(tabs()[0]);
    await press("ArrowRight");
    expect(tabs()[1]!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs()[1]);
    await press("ArrowRight");
    expect(document.activeElement).toBe(tabs()[0]);
    await press("End");
    expect(document.activeElement).toBe(tabs()[1]);
    await press("Home");
    expect(document.activeElement).toBe(tabs()[0]);
    await press("ArrowLeft");
    expect(document.activeElement).toBe(tabs()[1]);
    await act(async () => tabs()[0]!.click());
    expect(panels()[0]!.hidden).toBe(false);
    // The hidden panel's form stays mounted, so its typed facts survive a tab switch.
    expect(panels()[1]!.querySelector('[name="sshLogin"]')).not.toBeNull();
    expect(adjacentTab("Tab", "provider")).toBeNull();
});

it("closes on Escape and on the close button, returning focus to the opening control", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    const returnFocusTo = createRef<HTMLElement>() as React.RefObject<HTMLElement | null>;
    returnFocusTo.current = trigger;
    const onClose = vi.fn();
    await render({ onClose, returnFocusTo });
    const dialog = container.querySelector("dialog")!;
    const cancel = new Event("cancel", { cancelable: true });
    await act(async () => dialog.dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
    expect(onClose).toHaveBeenCalledTimes(2);
    await act(async () => root.render(null));
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
});

it("onboards a provider-account VPS with its listed provider and keeps the result visible after refreshing in place", async () => {
    request.mockResolvedValueOnce({ outcome: "registered" });
    await render();
    const provider = panels()[0]!;
    expect(provider.textContent).toContain("Onboard provider-account VPS");
    expect(provider.textContent).toContain("For OVHcloud and Contabo");
    const select = provider.querySelector<HTMLSelectElement>('select[name="host"]')!;
    // A single listed VPS is preselected; its value carries the provider so onboarding never guesses it.
    expect(select.value).toBe(JSON.stringify({ provider: "contabo-vps", serviceName: "203779521" }));
    await act(async () => provider.querySelector("form")!.requestSubmit());
    expect(request.mock.calls[0]?.[0]).toMatchObject({ operation: "onboard-vps-host", input: { provider: "contabo-vps", serviceName: "203779521", mode: "enroll" } });
    expect(refresh).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
    // The refresh restarts the billing read; the form and its result stay mounted on the last listed hosts.
    await render({ providerAccount: { ...LOADED, availableHosts: null, pending: true } });
    expect(panels()[0]!.querySelector('[role="status"]')).not.toBeNull();
    expect(panels()[0]!.querySelector('select[name="host"] option[value*="203779521"]')).not.toBeNull();
});

it("explains a pending provider-account read, then preselects the only VPS once it loads", async () => {
    await render({ providerAccount: { availableHosts: null, pending: true, error: null, failedProviderReads: null } });
    const provider = () => panels()[0]!;
    expect(provider().textContent).toContain("Loading provider account inventory…");
    expect(provider().querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    await render({ providerAccount: LOADED });
    expect(provider().textContent).not.toContain("Loading provider account inventory");
    expect(provider().querySelector<HTMLSelectElement>('select[name="host"]')!.value).toContain("203779521");
    expect(provider().querySelector<HTMLButtonElement>('button[type="submit"]')!.textContent).toBe("Onboard VPS");
});

it("lists several provider-account VPSes without preselecting one", async () => {
    await render({ providerAccount: { ...LOADED, availableHosts: [CONTABO, OVH] } });
    const select = panels()[0]!.querySelector<HTMLSelectElement>('select[name="host"]')!;
    expect([...select.options].map((option) => option.textContent)).toEqual(["Select…", CONTABO.label, OVH.label]);
    expect(select.value).toBe("");
});

it("keeps manual entry available when the provider-account inventory cannot be read", async () => {
    await render({ providerAccount: { availableHosts: null, pending: false, error: "Billing readings timed out.", failedProviderReads: null } });
    const [provider, manual] = panels();
    expect(provider!.querySelector('[role="status"]')!.textContent).toContain("Provider account inventory is unavailable, so unregistered VPS products cannot be listed for onboarding. Manual entry still works.");
    expect(provider!.textContent).toContain("Billing readings timed out.");
    expect(provider!.querySelector<HTMLButtonElement>('button[type="submit"]')!.textContent).toBe("Unavailable");
    expect(manual!.querySelector<HTMLButtonElement>('button[type="submit"]')!.textContent).toBe("Add manual VPS");
});

it("offers every stored region and the listed manual-entry providers on the Manual entry tab", async () => {
    await render({ initialTab: "manual" });
    const manual = panels()[1]!;
    expect(manual.textContent).toContain("Add manual VPS");
    expect(manual.querySelector<HTMLSelectElement>('select[name="provider"]')!.value).toBe("hosthatch-vps");
    // Onboarding adds capacity, so regions without a free slot are offered too.
    const regions = [...manual.querySelector<HTMLSelectElement>('select[name="region"]')!.options].map((option) => option.value);
    expect(regions).toEqual(expect.arrayContaining(["us-east", "us-west"]));
    expect(manual.textContent).not.toContain("No provider currently accepts manual entry.");
    // The control plane scans and pins the host key on first contact, so the form never asks for one.
    expect(manual.querySelector('[name="hostPublicKey"]')).toBeNull();
});

it("explains an unreadable region catalog on the Manual entry tab", async () => {
    await render({ initialTab: "manual", regions: null, regionsError: "The operation is not supported." });
    expect(panels()[1]!.textContent).toContain("Regions are unavailable: The operation is not supported.");
});

it("names failed provider reads and a retained inventory, and stays silent when the read is complete", () => {
    expect(providerAccountNotice(LOADED, true)).toBeNull();
    expect(providerAccountNotice({ ...LOADED, availableHosts: null, pending: true }, false)).toBeNull();
    expect(providerAccountNotice({ ...LOADED, failedProviderReads: "The Contabo account read failed." }, true))
        .toEqual({ summary: "The Contabo account read failed.", detail: "Manual entry still works." });
    expect(providerAccountNotice({ ...LOADED, error: "Billing readings timed out." }, true))
        .toEqual({ summary: "Showing the last provider account inventory; retrying automatically.", detail: "Billing readings timed out." });
});
