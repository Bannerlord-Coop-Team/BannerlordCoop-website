import { LocalizationProvider } from "@/app/lib/localization/client";
import servers from "@/app/lib/localization/dictionaries/en/servers.json";
import serverCommon from "@/app/lib/localization/dictionaries/en/server-common.json";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ServerOnboarding } from "./ServerOnboarding";
import { onboardingSummary } from "../../../../tests/onboarding-fixtures";
import { HOSTING_CONTINENTS, HOSTING_REGIONS, type HostingRegionDefinition } from "../../../../supabase/functions/_shared/hosting-regions";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
// An injected catalog adds a region on the last continent so tabs wrap and skip every disabled continent between.
const lastContinent = HOSTING_CONTINENTS[HOSTING_CONTINENTS.length - 1];
const added: HostingRegionDefinition = { key: "test-region", label: "Test Region", continent: lastContinent, placement: { countryCodes: ["JP"] } };
const catalog = [...HOSTING_REGIONS, added];
const continentLabel = (id: string) => servers[`continent.${id}` as keyof typeof servers] as string;
/** Offered regions on one continent, in catalog order. */
const regionsOn = (continent: string) => catalog.filter((region) => region.continent === continent).map((region) => region.key);
const enabled = HOSTING_CONTINENTS.filter((id) => regionsOn(id).length > 0);
/** The expected selected tab, focused tab and visible regions for one enabled continent. */
const showing = (position: number) => {
    const id = enabled[(position + enabled.length) % enabled.length];
    return { tab: continentLabel(id), focused: continentLabel(id), regions: regionsOn(id) };
};

let container: HTMLDivElement; let root: Root;
beforeEach(async () => {
    vi.useFakeTimers(); window.sessionStorage.clear();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    // The stored catalog also offers the added region.
    const summary = onboardingSummary();
    summary.regions.push({ region: added.key, available: true, request: null });
    await act(async () => root.render(<LocalizationProvider locale="en" messages={{ servers, "server-common": serverCommon }}>
        <ServerOnboarding summary={summary} userId="account-a" catalog={catalog} />
    </LocalizationProvider>));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => tab("Set up server ").click());
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

/** Finds a button by its exact text. */
function tab(text: string) {
    const found = [...container.querySelectorAll("button")].find((button) => button.textContent === text);
    expect(found, text).toBeDefined(); return found!;
}
/** Sends one key to the focused continent tab. */
async function press(key: string) {
    const focused = document.activeElement as HTMLElement;
    await act(async () => focused.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
}
/** The selected tab's label and the region radio values it shows. */
function current() {
    return { tab: container.querySelector('[role="tab"][aria-selected="true"]')?.textContent, focused: document.activeElement?.textContent,
        regions: [...container.querySelectorAll<HTMLInputElement>('input[name="region"]')].map((input) => input.value) };
}

it("wraps ArrowLeft from the first enabled continent to the last, skipping disabled ones", async () => {
    tab(showing(0).tab).focus();
    await press("ArrowLeft");
    expect(current()).toEqual(showing(-1));
    await press("ArrowLeft");
    expect(current()).toEqual(showing(-2));
});

it("moves ArrowRight past disabled continents and wraps from the last", async () => {
    tab(showing(-2).tab).focus(); await act(async () => tab(showing(-2).tab).click());
    await press("ArrowRight");
    expect(current().tab).toBe(showing(-1).tab);
    await press("ArrowRight");
    expect(current()).toEqual(showing(0));
});

it("jumps to the last enabled continent with End and back to the first with Home", async () => {
    tab(showing(0).tab).focus();
    await press("End");
    expect(current()).toEqual(showing(-1));
    expect(container.querySelector<HTMLInputElement>('input[name="region"]:checked')?.value).toBe(showing(-1).regions[0]);
    await press("Home");
    expect(current()).toEqual(showing(0));
    await press("a");
    expect(current().tab).toBe(showing(0).tab);
});
