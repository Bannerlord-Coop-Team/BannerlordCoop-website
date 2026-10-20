import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManualVpsOnboardingCard } from "./ManualVpsOnboardingCard";
import type { HostingRegionPayload } from "../../../../supabase/functions/_shared/hosting-regions";

const { request, session, refresh, push } = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/app/lib/control-plane/client", async (importOriginal) => ({
    ...await importOriginal<typeof import("@/app/lib/control-plane/client")>(), requestControlPlaneAdmin: request,
}));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: session } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));

const REGIONS: HostingRegionPayload[] = [
    { region: "benelux", placement: { countryCodes: ["NL", "BE"] } },
    { region: "us-west", placement: { countryCodes: ["US"], locationIds: ["us-west-or"] } },
];
const PROVIDERS = [{ provider: "hosthatch-vps", displayName: "HostHatch VPS" }];
// A syntactically complete OpenSSH Ed25519 line: the fixed algorithm prefix plus 43 more base64 characters.
const HOST_KEY = `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${"B".repeat(43)} root@ams-1`;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    session.mockResolvedValue({ data: { session: { access_token: "test-only" } } });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

/** Renders the card with the given providers and catalog. */
async function render(providers = PROVIDERS, regions: HostingRegionPayload[] | null = REGIONS) {
    await act(async () => root.render(<ManualVpsOnboardingCard providers={providers} regions={regions} regionsError={regions === null ? "Catalog down." : null} />));
}

/** The form control with the given name. */
function control<T extends HTMLElement = HTMLInputElement>(name: string) {
    return container.querySelector<T>(`[name="${name}"]`)!;
}

/** Types into or selects a value on a controlled control the way a browser would. */
async function enter(name: string, value: string) {
    const element = control<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(name);
    await act(async () => {
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!.call(element, value);
        element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    });
}

/** Fills every required field with a valid HostHatch host in Benelux. */
async function fillValidForm() {
    await enter("serviceName", "hosthatch-ams-1");
    await enter("sshLogin", "root@45.91.20.7");
    await enter("hostPublicKey", HOST_KEY);
    await enter("vCpu", "8");
    await enter("region", "benelux");
    await enter("countryCode", "NL");
    await enter("locationId", "ams");
}

function optionValues(name: string) {
    return [...control<HTMLSelectElement>(name).options].map((option) => option.value).filter(Boolean);
}

async function submit() {
    await act(async () => container.querySelector("form")!.requestSubmit());
}

it("is unavailable with an explanation when no provider accepts manual entry", async () => {
    await render([]);
    expect(container.querySelector("fieldset")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect(container.textContent).toContain("No provider currently accepts manual entry.");
    expect(container.textContent).toContain("Unavailable");
});

it("is unavailable with the catalog error when regions cannot be read", async () => {
    await render(PROVIDERS, null);
    expect(container.querySelector("fieldset")!.disabled).toBe(true);
    expect(container.textContent).toContain("Regions are unavailable: Catalog down.");
});

it("narrows country to the region and switches location between free text and the region's list", async () => {
    await render();
    expect(control("provider").value).toBe("hosthatch-vps");
    expect(control<HTMLSelectElement>("countryCode").disabled).toBe(true);
    await enter("region", "benelux");
    expect(optionValues("countryCode")).toEqual(["NL", "BE"]);
    expect(control("countryCode").value).toBe("");
    expect(control("locationId").tagName).toBe("INPUT");
    await enter("countryCode", "BE");
    await enter("region", "us-west");
    expect(optionValues("countryCode")).toEqual(["US"]);
    expect(control("countryCode").value).toBe("US");
    expect(control("locationId").tagName).toBe("SELECT");
    expect(optionValues("locationId")).toEqual(["us-west-or"]);
    expect(control("locationId").value).toBe("us-west-or");
});

it("shows the slot count for the entered vCPUs", async () => {
    await render();
    await enter("vCpu", "7");
    expect(container.textContent).toContain("3 game slots.");
    await enter("vCpu", "2");
    expect(container.textContent).toContain("1 game slot.");
});

it("shows field errors without asking for confirmation or sending anything", async () => {
    const confirm = vi.spyOn(window, "confirm");
    await render();
    await fillValidForm();
    await enter("sshLogin", "debian@45.91.20.7");
    await enter("hostPublicKey", "ssh-rsa AAAA");
    await submit();
    expect(confirm).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(control("sshLogin").getAttribute("aria-invalid")).toBe("true");
    expect(control("hostPublicKey").getAttribute("aria-invalid")).toBe("true");
    expect(control("serviceName").getAttribute("aria-invalid")).toBe("false");
    expect(container.textContent).toContain("Enter root@ followed by the VPS's public IPv4 address.");
});

it("sends nothing when the administrator does not confirm the IPv4 address", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await render();
    await fillValidForm();
    await submit();
    expect(confirm.mock.calls[0]?.[0]).toContain("45.91.20.7");
    expect(request).not.toHaveBeenCalled();
});

it("submits the exact strict input with blank optional fields as null, then opens the VPS view", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    request.mockResolvedValueOnce({ onboarding: { state: "queued", progressStage: "queued" } });
    await render();
    await fillValidForm();
    await submit();
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toMatchObject({ accessToken: "test-only", operation: "onboard-manual-vps-host" });
    expect(request.mock.calls[0]?.[0].input).toStrictEqual({
        provider: "hosthatch-vps", serviceName: "hosthatch-ams-1", sshLogin: "root@45.91.20.7", hostPublicKey: HOST_KEY,
        vCpu: 8, region: "benelux", countryCode: "NL", locationId: "ams", publicHostname: null, datacenter: null,
    });
    expect(push).toHaveBeenCalledWith("/admin/control-plane?view=vps");
    expect(container.textContent).toContain("VPS onboarding queued: queued.");
});

it("keeps the entered facts and shows the control plane's rejection", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    request.mockRejectedValueOnce(new Error("The host key does not match."));
    await render();
    await fillValidForm();
    await enter("publicHostname", "play.example.com");
    await submit();
    expect(request.mock.calls[0]?.[0].input).toMatchObject({ publicHostname: "play.example.com", datacenter: null });
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("The host key does not match.");
    expect(control("serviceName").value).toBe("hosthatch-ams-1");
    expect(push).not.toHaveBeenCalled();
});
