import { LocalizationProvider } from "@/app/lib/localization/client";
import servers from "@/app/lib/localization/dictionaries/en/servers.json";
import serverCommon from "@/app/lib/localization/dictionaries/en/server-common.json";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ServerOnboarding } from "./ServerOnboarding";
import { onboardingSummary } from "../../../../tests/onboarding-fixtures";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
// A third enabled continent (Asia, after a disabled South America) exercises wrapping and skipping.
vi.mock("../../../../supabase/functions/_shared/hosting-regions", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../../supabase/functions/_shared/hosting-regions")>();
    const regions = [...actual.HOSTING_REGIONS, { key: "japan", label: "Japan", continent: "asia", placement: { countryCodes: ["JP"] } }];
    return { ...actual, HOSTING_REGIONS: regions,
        isHostingRegionKey: (value: unknown) => regions.some((region) => region.key === value),
        hostingRegion: (key: string) => regions.find((region) => region.key === key)! };
});

let container: HTMLDivElement; let root: Root;
beforeEach(async () => {
    vi.useFakeTimers(); window.sessionStorage.clear();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    // The fixture builds its stored catalog from the (mocked) website catalog, so it includes Japan.
    const summary = onboardingSummary();
    await act(async () => root.render(<LocalizationProvider locale="en" messages={{ servers: { ...servers, "region.japan": "Japan" }, "server-common": serverCommon }}>
        <ServerOnboarding summary={summary} userId="account-a" />
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
    tab("North America").focus();
    await press("ArrowLeft");
    expect(current()).toEqual({ tab: "Asia", focused: "Asia", regions: ["japan"] });
    await press("ArrowLeft");
    expect(current()).toEqual({ tab: "Europe", focused: "Europe", regions: ["france", "germany", "united-kingdom", "poland"] });
});

it("moves ArrowRight past a disabled continent and wraps from the last", async () => {
    tab("Europe").focus(); await act(async () => tab("Europe").click());
    await press("ArrowRight");
    expect(current().tab).toBe("Asia");
    await press("ArrowRight");
    expect(current()).toEqual({ tab: "North America", focused: "North America", regions: ["us-west", "us-east"] });
});

it("jumps to the last enabled continent with End and back to the first with Home", async () => {
    tab("North America").focus();
    await press("End");
    expect(current()).toEqual({ tab: "Asia", focused: "Asia", regions: ["japan"] });
    expect(container.querySelector<HTMLInputElement>('input[name="region"]:checked')?.value).toBe("japan");
    await press("Home");
    expect(current()).toEqual({ tab: "North America", focused: "North America", regions: ["us-west", "us-east"] });
    await press("a");
    expect(current().tab).toBe("North America");
});
