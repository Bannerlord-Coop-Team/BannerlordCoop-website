import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TestLocalization, serverTestMessages } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import type { MyServerMove, MyServerNotice } from "@/app/lib/control-plane/types";
import { createTranslator } from "@/app/lib/localization/translator";
import { ManagedServerMoveProvider } from "./ManagedServerMoveStatus";
import { ManagedServerNoticeBanner, noticeText } from "./ManagedServerNoticeBanner";

const dismiss = vi.hoisted(() => vi.fn());
vi.mock("@/app/servers/server-notice-actions", () => ({ dismissManagedServerNotice: dismiss }));
vi.mock("@/app/servers/managed-server-move-actions", () => ({ readManagedServerMoveStatus: async () => ({ ok: false }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const messages = serverTestMessages["managed-server"];
const serverId = "11111111-1111-4111-8111-111111111111";
const administrator: MyServerNotice = {
    noticeId: "66666666-6666-4666-8666-666666666666", kind: "administrator", severity: "info", title: "Maintenance <b>tonight</b>",
    body: "The host restarts at 22:00 UTC.\nExpect a short outage.", parameters: {}, createdAt: "2026-10-18T09:00:00.000Z", expiresAt: null,
};
const scheduled: MyServerNotice = {
    ...administrator, noticeId: "77777777-7777-4777-8777-777777777777", kind: "placement-scheduled", severity: "warning",
    title: "Server move scheduled", body: "English fallback", parameters: { scheduledAt: "2026-10-19T03:00:00.000Z", windowMinutes: 120 },
};
const completed: MyServerNotice = {
    ...administrator, noticeId: "88888888-8888-4888-8888-888888888888", kind: "placement-completed",
    title: "Server moved", body: "English fallback", parameters: { address: "203.0.113.10:4201", movedAt: "2026-10-19T03:20:00.000Z" },
};
// Formats in UTC so expectations do not depend on the machine running the tests.
const t = createTranslator("en", messages).t;
const utc = (value: string | number, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(new Date(value));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    dismiss.mockResolvedValue({ ok: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

async function render(notices: MyServerNotice[]) {
    await act(async () => root.render(<TestLocalization><ManagedServerNoticeBanner serverId={serverId} notices={notices} /></TestLocalization>));
}

function card(text: string) {
    return [...container.querySelectorAll<HTMLElement>('[role="status"], [role="alert"]')].find((item) => item.textContent?.includes(text))!;
}

it("writes placement notices from their parameters in the viewer's language", () => {
    expect(noticeText(scheduled, t, utc)).toEqual({
        title: messages["notices.placementScheduledTitle"],
        body: "This server will move to a new machine between Oct 19, 2026, 3:00 AM UTC and 5:00 AM UTC. Players get an in-game warning, the game stops for a few minutes, and its address and port change.",
    });
    expect(noticeText({ ...scheduled, parameters: { scheduledAt: "2026-10-19T03:00:00.000Z" } }, t, utc).body)
        .toBe("This server will move to a new machine around Oct 19, 2026, 3:00 AM UTC. Players get an in-game warning, the game stops for a few minutes, and its address and port change.");
    expect(noticeText(completed, t, utc)).toEqual({
        title: messages["notices.placementCompletedTitle"],
        body: "This server moved to a new machine to reduce slowdowns. Its new address is 203.0.113.10:4201; players need it to join.",
    });
    for (const parameters of [{}, { address: "javascript:alert(1)" }, { address: 4201 }] as MyServerNotice["parameters"][]) {
        expect(noticeText({ ...completed, parameters }, t, utc).body).toBe(messages["notices.placementCompletedBodyNoAddress"]);
    }
});

it("falls back to the stored text when a scheduled move has no usable time", () => {
    for (const parameters of [{}, { scheduledAt: "tomorrow", windowMinutes: 120 }, { scheduledAt: 1_760_000_000_000 }] as MyServerNotice["parameters"][]) {
        expect(noticeText({ ...scheduled, parameters }, t, utc)).toEqual({ title: "Server move scheduled", body: "English fallback" });
    }
    expect(noticeText(administrator, t, utc)).toEqual({ title: administrator.title, body: administrator.body });
});

it("shows administrator text as plain text with its line breaks and announces warnings as alerts", async () => {
    await render([scheduled, administrator]);

    const info = card("Maintenance");
    expect(info.getAttribute("role")).toBe("status");
    expect(info.querySelector("b")).toBeNull();
    expect(info.textContent).toContain("Maintenance <b>tonight</b>");
    const body = info.querySelector("p.whitespace-pre-wrap")!;
    expect(body.textContent).toBe("The host restarts at 22:00 UTC.\nExpect a short outage.");
    const warning = card(messages["notices.placementScheduledTitle"]);
    expect(warning.getAttribute("role")).toBe("alert");
    expect(warning.textContent).toContain(`${messages["notices.warning"]}: `);
    expect(warning.textContent).toContain("Players get an in-game warning");
    expect(container.querySelector("section")?.getAttribute("aria-label")).toBe(messages["notices.regionLabel"]);
});

it("hides a notice once it is dismissed, leaving the others", async () => {
    await render([administrator, completed]);
    const button = card("Maintenance").querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("Dismiss notice: Maintenance <b>tonight</b>");

    await act(async () => button.click());

    expect(dismiss).toHaveBeenCalledExactlyOnceWith({ serverId, noticeId: administrator.noticeId });
    expect(container.textContent).not.toContain("Maintenance");
    expect(container.textContent).toContain(messages["notices.placementCompletedTitle"]);

    await act(async () => card(messages["notices.placementCompletedTitle"]).querySelector("button")!.click());
    expect(container.querySelector("section")).toBeNull();
});

it("keeps the notice and explains why when it cannot be dismissed", async () => {
    dismiss.mockResolvedValueOnce({ ok: false, message: messages["notices.dismissReadOnly"] });
    dismiss.mockRejectedValueOnce(new Error("network"));
    await render([administrator]);

    await act(async () => card("Maintenance").querySelector("button")!.click());
    expect(card("Maintenance").textContent).toContain(messages["notices.dismissReadOnly"]);

    await act(async () => card("Maintenance").querySelector("button")!.click());
    expect(card("Maintenance").textContent).toContain(messages["notices.dismissFailed"]);
    expect(card("Maintenance").textContent).not.toContain(messages["notices.dismissReadOnly"]);
});

it("renders nothing without notices", async () => {
    await render([]);
    expect(container.innerHTML).toBe("");
});

const move = (state: MyServerMove["state"]): MyServerMove => ({
    state, scheduledAt: "2026-10-19T03:00:00.000Z", startedAt: null, step: null, stayedOnOriginal: null,
    completedAt: state === "moved" || state === "failed" ? "2026-10-19T03:20:00.000Z" : null,
    address: state === "moved" ? "203.0.113.10:4201" : null,
});
// The control plane writes this move's completion notice as the move settles, just after its job completes.
const currentCompletion: MyServerNotice = { ...completed, createdAt: "2026-10-19T03:20:01.000Z" };

it.each([
    [null, [true, true]],
    ["scheduled", [false, true]],
    ["starting", [false, true]],
    ["moving", [false, true]],
    ["returning", [false, true]],
    // The announcement can outlive the move by up to a minute, until the control plane withdraws it.
    ["moved", [false, false]],
    ["failed", [false, true]],
] as const)("leaves the placement notices that a %s move's status card covers to it", async (state, [scheduledShown, completedShown]) => {
    await act(async () => root.render(<TestLocalization><ManagedServerMoveProvider serverId={serverId} initialMove={state === null ? null : move(state)}>
        <ManagedServerNoticeBanner serverId={serverId} notices={[administrator, scheduled, currentCompletion]} /></ManagedServerMoveProvider></TestLocalization>));
    expect(card("Maintenance")).toBeDefined();
    expect(card(messages["notices.placementScheduledTitle"]) !== undefined).toBe(scheduledShown);
    expect(card(messages["notices.placementCompletedTitle"]) !== undefined).toBe(completedShown);
});

it.each([
    ["this move's completion", {}, false],
    ["a completion without an address from this move", { parameters: { movedAt: "2026-10-19T03:20:00.000Z" } }, false],
    ["an earlier move's completion", { createdAt: "2026-10-19T03:19:59.999Z" }, true],
    ["a completion for another address", { parameters: { movedAt: "2026-10-19T03:20:00.000Z", address: "198.51.100.7:4201" } }, true],
] as const)("beside a moved card, hides %s notice only when it is this move's: shown=%s", async (_case, fields, shown) => {
    await act(async () => root.render(<TestLocalization><ManagedServerMoveProvider serverId={serverId} initialMove={move("moved")}>
        <ManagedServerNoticeBanner serverId={serverId} notices={[{ ...currentCompletion, ...fields }]} /></ManagedServerMoveProvider></TestLocalization>));
    expect(card(messages["notices.placementCompletedTitle"]) !== undefined).toBe(shown);
});
