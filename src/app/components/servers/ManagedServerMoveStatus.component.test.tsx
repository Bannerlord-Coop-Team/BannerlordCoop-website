import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TestLocalization, serverTestMessages } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import type { MyServerMove, MyServerNotice } from "@/app/lib/control-plane/types";
import { ManagedServerMoveProvider, ManagedServerMoveStatus, serverMovePollDelay } from "./ManagedServerMoveStatus";
import { ServerManagementWorkspace } from "./ServerManagementWorkspace";
import { ZONED_DATE_TIME_FORMAT } from "./viewer-time-zone";

const mocks = vi.hoisted(() => ({ read: vi.fn(), dismiss: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => { const router = { refresh: mocks.refresh }; return { useRouter: () => router }; });
vi.mock("@/app/servers/managed-server-move-actions", () => ({ readManagedServerMoveStatus: mocks.read }));
vi.mock("@/app/servers/server-notice-actions", () => ({ dismissManagedServerNotice: mocks.dismiss }));

const messages = serverTestMessages["managed-server"];
const serverId = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-10-19T02:00:00.000Z");
const at = (offset: number) => new Date(NOW + offset).toISOString();
const move = (state: MyServerMove["state"], fields: Partial<MyServerMove> = {}): MyServerMove => ({
    state, scheduledAt: null, startedAt: null, completedAt: null, step: null, address: null, stayedOnOriginal: null, ...fields,
});
const scheduled = move("scheduled", { scheduledAt: at(42 * 60_000 + 10_000) });
const moving = move("moving", { scheduledAt: at(-300_000), startedAt: at(-250_000), step: "restoring" });
const moved = move("moved", { startedAt: at(-900_000), completedAt: at(-60_000), address: "203.0.113.20:4201" });
const notice = (noticeId: string, kind: MyServerNotice["kind"], fields: Partial<MyServerNotice> = {}): MyServerNotice => ({
    noticeId, kind, severity: "info", title: "Stored title", body: "Stored body", parameters: {}, createdAt: at(-3_600_000), expiresAt: null, ...fields,
});
const administrator = notice("66666666-6666-4666-8666-666666666666", "administrator");
const scheduledNotice = notice("77777777-7777-4777-8777-777777777777", "placement-scheduled");
// The control plane writes a move's completion notice as the move settles, just after its job completes.
const completedNotice = notice("88888888-8888-4888-8888-888888888888", "placement-completed",
    { createdAt: at(-59_000), parameters: { movedAt: moved.completedAt, address: moved.address } });
// A server keeps completion notices for 14 days, so an earlier move's notice can still be on the page.
const earlierCompletion = notice("99999999-9999-4999-8999-999999999999", "placement-completed",
    { createdAt: at(-3 * 86_400_000), parameters: { movedAt: at(-3 * 86_400_000), address: "198.51.100.7:4201" } });

let container: HTMLDivElement;
let root: Root;
let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    localStorage.clear();
    mocks.read.mockResolvedValue({ ok: false });
    mocks.dismiss.mockResolvedValue({ ok: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(document, "visibilityState");
    vi.useRealTimers();
});

async function render(initialMove: MyServerMove | null, notices: MyServerNotice[] = [], headerAddress: string | null = null) {
    await act(async () => root.render(<TestLocalization><ManagedServerMoveProvider serverId={serverId} initialMove={initialMove} headerAddress={headerAddress}>
        <ManagedServerMoveStatus notices={notices} /></ManagedServerMoveProvider></TestLocalization>));
}

/** Resolves when the test settles it, like a read still on its way back from the server. */
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((settle) => { resolve = settle; });
    return { promise, resolve };
}

/** Starts a fresh page, as a reload would. */
async function freshPage() {
    await act(async () => root.unmount());
    root = createRoot(container);
}

async function reload(initialMove: MyServerMove | null, notices: MyServerNotice[] = []) {
    await freshPage();
    await render(initialMove, notices);
}

/** Advances fake time, flushing the reads and renders it causes. */
async function advance(milliseconds: number) {
    await act(async () => vi.advanceTimersByTimeAsync(milliseconds));
}

async function setVisibility(state: DocumentVisibilityState) {
    visibility = state;
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
}

const card = () => container.querySelector("section");
const announcement = () => container.querySelector('[role="status"]')!.textContent;
const button = (label: string) => [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);

it("counts down to an announced move each second without announcing every second", async () => {
    await render(scheduled);
    await advance(0);
    const section = card()!;
    expect(section.querySelector("h2")!.textContent).toBe(messages["move.scheduledTitle"]);
    expect(section.getAttribute("aria-labelledby")).toBe(section.querySelector("h2")!.id);
    expect(section.textContent).toContain("Starts in 42 min 10 s");
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(section.textContent).toContain(`Scheduled for ${new Intl.DateTimeFormat("en", { ...ZONED_DATE_TIME_FORMAT, timeZone: zone }).format(new Date(scheduled.scheduledAt!))}`);
    expect(section.textContent).toContain("Players get an in-game warning first");
    expect(section.textContent).toContain("saves, settings, password and backups move with it");
    expect(section.textContent).toContain("The address and port change, and the new address will appear here.");
    expect(announcement()).toBe(messages["move.scheduledTitle"]);
    expect(section.querySelector("button")).toBeNull();

    await advance(1_000);
    expect(card()!.textContent).toContain("Starts in 42 min 9 s");
    expect(announcement()).toBe(messages["move.scheduledTitle"]);
});

it("writes longer and passed countdowns in whole units", async () => {
    await render(move("scheduled", { scheduledAt: at(65 * 60_000) }));
    await advance(0);
    expect(card()!.textContent).toContain("Starts in 1 h 5 min");
    await reload(move("scheduled", { scheduledAt: at(9_000) }));
    await advance(0);
    expect(card()!.textContent).toContain("Starts in 9 s");
    await advance(10_000);
    expect(card()!.textContent).toContain(messages["move.startsAnyMoment"]);
});

it("renders the announced time in UTC and no countdown on the server, so hydration matches", () => {
    const html = renderToStaticMarkup(<TestLocalization><ManagedServerMoveProvider serverId={serverId} initialMove={scheduled}>
        <ManagedServerMoveStatus notices={[]} /></ManagedServerMoveProvider></TestLocalization>);
    expect(html).toContain(`Scheduled for ${new Intl.DateTimeFormat("en", { ...ZONED_DATE_TIME_FORMAT, timeZone: "UTC" }).format(new Date(scheduled.scheduledAt!))}`);
    expect(html).not.toContain("Starts in");
});

it("explains a move waiting for the server's current task", async () => {
    await render(move("starting", { scheduledAt: at(-30_000) }));
    expect(card()!.querySelector("h2")!.textContent).toBe(messages["move.startingTitle"]);
    expect(card()!.textContent).toContain(messages["move.startingBody"]);
    expect(card()!.querySelector("button, ol")).toBeNull();
});

it("shows a page opened mid-move with the steps done, the current step and the time elapsed", async () => {
    await render(moving);
    await advance(0);
    const steps = [...card()!.querySelectorAll("ol > li")];
    expect(card()!.querySelector("ol")!.getAttribute("aria-label")).toBe(messages["move.stepsLabel"]);
    expect(steps.map((step) => step.textContent)).toEqual([
        `Preparing${messages["controls.completed"]}`,
        `Saving and stopping the game${messages["controls.completed"]}`,
        `Creating a restore point${messages["controls.completed"]}`,
        `Restoring on the new machine${messages["controls.currentPhase"]}`,
        `Switching to the new address${messages["controls.waiting"]}`,
        `Starting the game${messages["controls.waiting"]}`,
        `Finishing${messages["controls.waiting"]}`,
    ]);
    expect(steps.findIndex((step) => step.getAttribute("aria-current") === "step")).toBe(3);
    expect(card()!.textContent).toContain("4 min 10 s elapsed");
    expect(card()!.textContent).toContain(messages["move.movingBody"]);
    expect(announcement()).toBe(`${messages["move.movingTitle"]} Current step: Restoring on the new machine`);
    expect(card()!.querySelector("button")).toBeNull();

    await advance(1_000);
    expect(card()!.textContent).toContain("4 min 11 s elapsed");
});

it("marks no step as done or current while a move has not reported its step", async () => {
    await render({ ...moving, step: null });
    const steps = [...card()!.querySelectorAll("ol > li")];
    expect(steps.map((step) => step.textContent)).toEqual([
        "Preparing", "Saving and stopping the game", "Creating a restore point", "Restoring on the new machine",
        "Switching to the new address", "Starting the game", "Finishing",
    ]);
    expect(card()!.querySelector('[aria-current="step"]')).toBeNull();
    expect(card()!.textContent).toContain(messages["move.inProgress"]);
    expect(announcement()).toBe(messages["move.movingTitle"]);
});

it("explains that a failed move is putting the server back on its original machine", async () => {
    await render(move("returning", { startedAt: at(-600_000), step: "restoring" }));
    await advance(0);
    expect(card()!.querySelector("h2")!.textContent).toBe(messages["move.returningTitle"]);
    expect(card()!.textContent).toContain(messages["move.returningProgress"]);
    expect(card()!.textContent).toContain(messages["move.returningBody"]);
    expect(card()!.textContent).toContain("10 min 0 s elapsed");
    expect(card()!.querySelector("ol, button")).toBeNull();
    expect(card()!.className).toContain("border-amber-400/40");
    expect(announcement()).toBe(`${messages["move.returningTitle"]} ${messages["move.returningProgress"]}`);
});

it.each([
    [true, "move.failedStayedTitle", "move.failedStayedBody", "border-white/15"],
    [false, "move.failedAttentionTitle", "move.failedAttentionBody", "border-amber-400/40"],
    [null, "move.failedAttentionTitle", "move.failedAttentionBody", "border-amber-400/40"],
] as const)("reports a failed move where the server stayed on its original machine: %s", async (stayedOnOriginal, title, body, tone) => {
    await render(move("failed", { startedAt: at(-900_000), completedAt: at(-60_000), stayedOnOriginal }), [completedNotice]);
    expect(card()!.querySelector("h2")!.textContent).toBe(messages[title]);
    expect(card()!.textContent).toContain(messages[body]);
    expect(card()!.className).toContain(tone);

    await act(async () => button(messages["notices.dismiss"])!.click());
    expect(card()).toBeNull();
    expect(mocks.dismiss).not.toHaveBeenCalled();
});

it("shows the new address once the move finishes, reveals it in the header and copies it", async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    mocks.read.mockResolvedValue({ ok: true, move: moved });
    await act(async () => root.render(<TestLocalization><ManagedServerMoveProvider serverId={serverId} initialMove={moving}>
        <ServerManagementWorkspace name={<h1>Campaign</h1>} summary="Summary" address="203.0.113.20:4201" banner={<ManagedServerMoveStatus notices={[]} />}>{null}</ServerManagementWorkspace>
    </ManagedServerMoveProvider></TestLocalization>));
    const header = container.querySelector("#server-address")!;
    expect(header.textContent).toBe("IP hidden");

    await advance(5_000);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(card()!.querySelector("h2")!.textContent).toBe(messages["move.movedTitle"]);
    expect(card()!.textContent).toContain(messages["move.movedBody"]);
    expect(card()!.textContent).toContain("203.0.113.20:4201");
    expect(card()!.className).toContain("border-emerald-500/30");
    expect(header.textContent).toBe("203.0.113.20:4201");
    expect(header.className).toContain("animate-pulse");

    await act(async () => button(messages["move.copyAddress"])!.click());
    expect(writeText).toHaveBeenCalledExactlyOnceWith("203.0.113.20:4201");
    expect(button(messages["move.copied"])).toBeDefined();
    await advance(2_000);
    await act(async () => button(messages["move.copyAddress"])!.click());
    expect(card()!.textContent).toContain(messages["move.copyFailed"]);
    Reflect.deleteProperty(navigator, "clipboard");
});

async function renderWorkspace(initialMove: MyServerMove | null, address: string | null) {
    await act(async () => root.render(<TestLocalization><ManagedServerMoveProvider serverId={serverId} initialMove={initialMove}>
        <ServerManagementWorkspace name={<h1>Campaign</h1>} summary="Summary" address={address} banner={<ManagedServerMoveStatus notices={[]} />}>{null}</ServerManagementWorkspace>
    </ManagedServerMoveProvider></TestLocalization>));
}

it("reveals the header address only once the header has the new one, and only once per move", async () => {
    mocks.read.mockResolvedValue({ ok: true, move: moved });
    await renderWorkspace(moving, "198.51.100.7:4201");
    const header = container.querySelector("#server-address")!;
    await advance(5_000);
    expect(card()!.querySelector("h2")!.textContent).toBe(messages["move.movedTitle"]);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    // The refreshed page has not delivered the new address yet, so the old one stays hidden.
    expect(header.textContent).toBe("IP hidden");
    expect(header.className).not.toContain("animate-pulse");

    await renderWorkspace(moving, moved.address!);
    expect(header.textContent).toBe(moved.address);
    expect(header.className).toContain("animate-pulse");

    // Hiding it again sticks through later reads and renders.
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Hide server IP and port"]')!.click());
    await advance(60_000);
    await renderWorkspace(moving, moved.address!);
    expect(header.textContent).toBe("IP hidden");
});

it("reveals the header address on a page opened after the move, unless that move was dismissed", async () => {
    await renderWorkspace(moved, moved.address!);
    expect(container.querySelector("#server-address")!.textContent).toBe(moved.address);

    await freshPage();
    await renderWorkspace(moved, "198.51.100.7:4201");
    expect(container.querySelector("#server-address")!.textContent).toBe("IP hidden");

    localStorage.setItem(`bannerlordcoop.servers.moveDismissed.${serverId}`, moved.completedAt!);
    await freshPage();
    await renderWorkspace(moved, moved.address!);
    expect(container.querySelector("#server-address")!.textContent).toBe("IP hidden");
});

it("tells players the new address will appear once assigned when the move reports none", async () => {
    await renderWorkspace({ ...moved, address: null }, null);
    expect(container.querySelector("#server-address")!.textContent).toBe("Not assigned");
    expect(card()!.textContent).toContain("so players need the new address to join. It will appear at the top of this page once it is assigned.");
    expect(button(messages["move.copyAddress"])).toBeUndefined();
});

it("dismisses a finished move for this browser along with this move's completion notice only", async () => {
    await render(moved, [administrator, scheduledNotice, earlierCompletion, completedNotice]);
    const dismiss = button(messages["notices.dismiss"])!;
    expect(dismiss.getAttribute("aria-label")).toBe(`Dismiss notice: ${messages["move.movedTitle"]}`);

    await act(async () => dismiss.click());
    expect(card()).toBeNull();
    expect(announcement()).toBe("");
    expect(mocks.dismiss).toHaveBeenCalledExactlyOnceWith({ serverId, noticeId: completedNotice.noticeId });
    expect(localStorage.getItem(`bannerlordcoop.servers.moveDismissed.${serverId}`)).toBe(moved.completedAt);

    await reload(moved);
    expect(card()).toBeNull();
    // A later move is new, so it shows again.
    await reload({ ...moved, completedAt: at(-1_000) });
    expect(card()).not.toBeNull();
});

it.each([
    ["was written before the move completed", { createdAt: at(-120_000) }],
    ["names another address", { parameters: { movedAt: moved.completedAt, address: "198.51.100.7:4201" } }],
] as const)("leaves a completion notice that %s", async (_case, fields) => {
    await render(moved, [{ ...completedNotice, ...fields }]);
    await act(async () => button(messages["notices.dismiss"])!.click());
    expect(mocks.dismiss).not.toHaveBeenCalled();
});

it("dismisses this move's completion notice once when it only arrives after the card was dismissed", async () => {
    await render(moved, [earlierCompletion]);
    await act(async () => button(messages["notices.dismiss"])!.click());
    expect(mocks.dismiss).not.toHaveBeenCalled();

    await render(moved, [earlierCompletion, completedNotice]);
    expect(mocks.dismiss).toHaveBeenCalledExactlyOnceWith({ serverId, noticeId: completedNotice.noticeId });
    await render(moved, [completedNotice, earlierCompletion]);
    await advance(60_000);
    expect(mocks.dismiss).toHaveBeenCalledOnce();

    // A later page load retries a notice that is still there, once.
    mocks.dismiss.mockClear();
    await reload(moved, [earlierCompletion, completedNotice]);
    expect(card()).toBeNull();
    expect(mocks.dismiss).toHaveBeenCalledExactlyOnceWith({ serverId, noticeId: completedNotice.noticeId });
});

it("keeps a dismissal on this page even when the notice cannot be dismissed", async () => {
    mocks.dismiss.mockRejectedValue(new Error("network"));
    await render(moved, [completedNotice]);
    await act(async () => button(messages["notices.dismiss"])!.click());
    expect(card()).toBeNull();
});

it("renders nothing without a move or outside a managed server page", async () => {
    await render(null);
    expect(card()).toBeNull();
    expect(announcement()).toBe("");
    await act(async () => root.render(<TestLocalization><ManagedServerMoveStatus notices={[]} /></TestLocalization>));
    expect(container.innerHTML).toBe("");
});

it("waits longer between reads the further away a move is", () => {
    const scheduledIn = (milliseconds: number) => move("scheduled", { scheduledAt: at(milliseconds) });
    expect(serverMovePollDelay(null, NOW)).toBe(60_000);
    expect(serverMovePollDelay(moved, NOW)).toBe(60_000);
    expect(serverMovePollDelay(move("failed", { completedAt: at(0) }), NOW)).toBe(60_000);
    expect(serverMovePollDelay(scheduledIn(10 * 60_000), NOW)).toBe(30_000);
    expect(serverMovePollDelay(scheduledIn(140_000), NOW)).toBe(20_000);
    expect(serverMovePollDelay(scheduledIn(122_000), NOW)).toBe(5_000);
    expect(serverMovePollDelay(scheduledIn(120_000), NOW)).toBe(5_000);
    expect(serverMovePollDelay(scheduledIn(-60_000), NOW)).toBe(5_000);
    for (const state of ["starting", "moving", "returning"] as const) expect(serverMovePollDelay(move(state), NOW)).toBe(5_000);
    expect([1, 2, 3, 7].map((failures) => serverMovePollDelay(moving, NOW, failures))).toEqual([10_000, 20_000, 40_000, 300_000]);
    expect(serverMovePollDelay(null, NOW, 2)).toBe(240_000);
    expect(serverMovePollDelay(null, NOW, 3)).toBe(300_000);
});

it("follows each state's read cadence as a move approaches and runs", async () => {
    mocks.read.mockResolvedValue({ ok: true, move: null });
    await render(null);
    await advance(59_999);
    expect(mocks.read).not.toHaveBeenCalled();
    await advance(1);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(serverId);

    // Announced while the page is open: every 30 s until two minutes before it starts, then every 5 s.
    const announced = move("scheduled", { scheduledAt: at(120_000 + 170_000) });
    mocks.read.mockResolvedValue({ ok: true, move: announced });
    await advance(60_000);
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(card()!.querySelector("h2")!.textContent).toBe(messages["move.scheduledTitle"]);
    await advance(29_999);
    expect(mocks.read).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(mocks.read).toHaveBeenCalledTimes(3);
    // The next read lands exactly when the final two minutes begin.
    await advance(19_999);
    expect(mocks.read).toHaveBeenCalledTimes(3);
    await advance(1);
    expect(mocks.read).toHaveBeenCalledTimes(4);
    await advance(5_000);
    expect(mocks.read).toHaveBeenCalledTimes(5);

    mocks.read.mockResolvedValue({ ok: true, move: moving });
    await advance(5_000);
    expect(mocks.read).toHaveBeenCalledTimes(6);
    await advance(5_000);
    expect(mocks.read).toHaveBeenCalledTimes(7);
});

it("refreshes the page once for each change it shows, not for a new step or an unchanged read", async () => {
    mocks.read
        .mockResolvedValueOnce({ ok: true, move: { ...moving, step: "preparing" } })
        .mockResolvedValueOnce({ ok: true, move: { ...moving, step: "switching-address" } })
        .mockResolvedValueOnce({ ok: true, move: moved })
        .mockResolvedValue({ ok: true, move: moved });
    await render(move("starting", { scheduledAt: at(-30_000) }), [], moved.address);

    await advance(5_000);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(card()!.querySelector('[aria-current="step"]')!.textContent).toContain("Preparing");
    await advance(5_000);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(card()!.querySelector('[aria-current="step"]')!.textContent).toContain("Switching to the new address");
    await advance(5_000);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(card()!.querySelector("h2")!.textContent).toBe(messages["move.movedTitle"]);
    await advance(120_000);
    expect(mocks.read).toHaveBeenCalledTimes(5);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
});

it("keeps the last status and backs off while reads fail", async () => {
    mocks.read
        .mockResolvedValueOnce({ ok: false })
        .mockRejectedValueOnce(new Error("network"))
        .mockResolvedValue({ ok: true, move: moving });
    await render(moving);
    await advance(5_000);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(card()!.querySelector("h2")!.textContent).toBe(messages["move.movingTitle"]);
    await advance(9_999);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(mocks.read).toHaveBeenCalledTimes(2);
    await advance(19_999);
    expect(mocks.read).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(mocks.read).toHaveBeenCalledTimes(3);
    await advance(5_000);
    expect(mocks.read).toHaveBeenCalledTimes(4);
    expect(card()!.querySelector("h2")!.textContent).toBe(messages["move.movingTitle"]);
    expect(mocks.refresh).not.toHaveBeenCalled();
});

it("reads only while the page is visible and catches up as soon as it is shown", async () => {
    mocks.read.mockResolvedValue({ ok: true, move: null });
    await render(null);
    await setVisibility("hidden");
    await advance(10 * 60_000);
    expect(mocks.read).not.toHaveBeenCalled();

    await setVisibility("visible");
    expect(mocks.read).toHaveBeenCalledOnce();
    await advance(60_000);
    expect(mocks.read).toHaveBeenCalledTimes(2);
});

it("reads as soon as the page is shown again, even before the next read was due", async () => {
    mocks.read.mockResolvedValue({ ok: true, move: null });
    await render(null);
    await advance(10_000);
    await setVisibility("hidden");
    await setVisibility("visible");
    expect(mocks.read).toHaveBeenCalledOnce();
    // The read replaces the one that was due, rather than adding to it.
    await advance(59_999);
    expect(mocks.read).toHaveBeenCalledOnce();
    await advance(1);
    expect(mocks.read).toHaveBeenCalledTimes(2);
});

it("reads again right after a read that was under way while the page was hidden", async () => {
    const underway = deferred<{ ok: true; move: MyServerMove }>();
    mocks.read.mockReturnValueOnce(underway.promise).mockResolvedValue({ ok: true, move: moved });
    await render(moving, [], moved.address);
    await advance(5_000);
    expect(mocks.read).toHaveBeenCalledOnce();
    await setVisibility("hidden");
    await setVisibility("visible");
    expect(mocks.read).toHaveBeenCalledOnce();

    await act(async () => underway.resolve({ ok: true, move: moving }));
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(card()!.querySelector("h2")!.textContent).toBe(messages["move.movedTitle"]);
});

it("shows the status a refreshed page renders at once and confirms it with a read", async () => {
    mocks.read.mockResolvedValue({ ok: true, move: moving });
    await render(scheduled);
    await render({ ...moving });
    await advance(0);
    expect(card()!.querySelector("h2")!.textContent).toBe(messages["move.movingTitle"]);
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(mocks.refresh).not.toHaveBeenCalled();
    // The same status rendered again needs no further read.
    await render({ ...moving });
    await advance(0);
    expect(mocks.read).toHaveBeenCalledOnce();
});

it("does not refresh back and forth when a refreshed page renders an older status", async () => {
    mocks.read.mockResolvedValue({ ok: true, move: moved });
    await render(moved, [], moved.address);
    for (let refresh = 1; refresh <= 3; refresh += 1) {
        await render({ ...moving }, [], moved.address);
        await advance(0);
        expect(mocks.read).toHaveBeenCalledTimes(refresh);
        expect(card()!.querySelector("h2")!.textContent).toBe(messages["move.movedTitle"]);
    }
    expect(mocks.refresh).not.toHaveBeenCalled();
});

it("keeps the move shown when a refreshed page renders none, and checks with a read", async () => {
    mocks.read.mockResolvedValue({ ok: true, move: moving });
    await render(moving);
    await render(null);
    await advance(0);
    expect(card()!.querySelector("h2")!.textContent).toBe(messages["move.movingTitle"]);
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(mocks.refresh).not.toHaveBeenCalled();
});

it("refreshes again, at most three times per move, while the header lacks the moved address", async () => {
    mocks.read.mockResolvedValue({ ok: true, move: moved });
    await render(moved, [], "198.51.100.7:4201");
    for (let read = 1; read <= 4; read += 1) await advance(60_000);
    expect(mocks.read).toHaveBeenCalledTimes(4);
    expect(mocks.refresh).toHaveBeenCalledTimes(3);

    // A later move refreshes for its change, then gets its own attempts; a header that has the address needs none.
    const later = { ...moved, completedAt: at(-1_000) };
    mocks.read.mockResolvedValue({ ok: true, move: later });
    await advance(60_000);
    expect(mocks.refresh).toHaveBeenCalledTimes(4);
    await advance(60_000);
    expect(mocks.refresh).toHaveBeenCalledTimes(5);
    await render(later, [], later.address);
    await advance(60_000);
    expect(mocks.refresh).toHaveBeenCalledTimes(5);
});

it("stops reading once the page closes", async () => {
    await render(moving);
    await act(async () => root.unmount());
    root = createRoot(container);
    await advance(10 * 60_000);
    expect(mocks.read).not.toHaveBeenCalled();
});
