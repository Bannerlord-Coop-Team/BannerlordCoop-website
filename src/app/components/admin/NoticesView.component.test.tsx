import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ControlPlaneAdminError } from "@/app/lib/control-plane/client";
import { localDateTimeToUtc, noticeInput, noticeRequestId, noticeTargetSummary } from "@/app/lib/control-plane/notices";
import type { HostingAdminNotice, ManagedServer, NoticesViewData } from "@/app/lib/control-plane/types";
import { NoticesView } from "./NoticesView";

const mocks = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn(), confirm: vi.fn() }));
vi.mock("@/app/lib/control-plane/client", async (original) => ({ ...await original<typeof import("@/app/lib/control-plane/client")>(), requestControlPlaneAdmin: mocks.request }));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: mocks.session } }) }));

function server(serverId: string, displayName: string): ManagedServer {
    return {
        serverId, displayName, friendlyRegion: "united-kingdom", ownerDiscordUserId: "123456789012345678", ownerAccountId: null,
        provider: "ovhcloud-vps", providerResourceId: null, providerLocationId: null, desiredState: "running",
        observedVmState: "running", observedGameState: "running", operationState: "running", releaseChannel: "stable",
        installedBuildId: null, desiredBuildId: null, pinnedBuildId: null, maintenanceSlot: "sunday-0400", activeSaveId: null,
        connectionHostname: null, connectionIp: null, gamePorts: [], deletionDueAt: null, lastHealthCheckAt: null,
        lastErrorCode: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-16T12:00:00.000Z",
    };
}

const gang = server("11111111-1111-4111-8111-111111111111", "The Gang");
const knights = server("22222222-2222-4222-8222-222222222222", "Calradian Knights");
const march = server("33333333-3333-4333-8333-333333333333", "March");
const data: NoticesViewData = { servers: { items: [gang, knights], nextCursor: null } };

function notice(noticeId: string, title: string, extra: Partial<HostingAdminNotice> = {}): HostingAdminNotice {
    return {
        noticeId, kind: "administrator", severity: "info", title, body: "First line\nSecond line", parameters: {},
        createdAt: "2026-10-18T09:00:00.000Z", expiresAt: null, state: "active", createdBy: "supabase:admin", reason: null,
        withdrawnAt: null, targetCount: 2, dismissalCount: 1, servers: [{ serverId: gang.serverId, displayName: gang.displayName }, { serverId: knights.serverId, displayName: knights.displayName }],
        ...extra,
    };
}

const maintenance = notice("66666666-6666-4666-8666-666666666666", "Maintenance tonight");
const moved = notice("77777777-7777-4777-8777-777777777777", "Server moved", { kind: "placement-completed", targetCount: 30, servers: [{ serverId: march.serverId, displayName: "March" }] });
const older = notice("88888888-8888-4888-8888-888888888888", "Older notice", { state: "expired", expiresAt: "2026-10-01T00:00:00.000Z" });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal("confirm", mocks.confirm);
    mocks.confirm.mockReturnValue(true);
    mocks.session.mockResolvedValue({ data: { session: { access_token: "test-only" } } });
    mocks.request.mockImplementation(async ({ operation, input }: { operation: string; input: Record<string, unknown> }) => {
        if (operation === "notices") return input.cursor === null ? { items: [maintenance, moved], nextCursor: "older" } : { items: [older], nextCursor: null };
        if (operation === "servers") return { items: [march], nextCursor: null };
        if (operation === "withdraw-notice") return { ...maintenance, state: "withdrawn", withdrawnAt: "2026-10-18T12:00:00.000Z" };
        return { outcome: "created", notice: maintenance };
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

function calls(operation: string) {
    return mocks.request.mock.calls.map(([request]) => request as { operation: string; requestId: string; input: Record<string, unknown> }).filter((request) => request.operation === operation);
}

function button(scope: ParentNode, text: string) {
    return [...scope.querySelectorAll("button")].find((item) => item.textContent?.trim() === text)!;
}

function option(name: string) {
    return [...container.querySelectorAll<HTMLLabelElement>('ul[aria-label="Servers to target"] label')].find((item) => item.textContent?.includes(name))!.querySelector("input")!;
}

async function type(selector: string, value: string) {
    await act(async () => {
        const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

async function post() {
    await act(async () => button(container, "Post notice").click());
}

it("checks notice content the way the control plane does", () => {
    const form = { title: "  Maintenance  ", body: "Line one\r\nLine two\n", severity: "warning" as const, expiresAt: "", reason: "" };
    expect(noticeInput(form, [gang.serverId, gang.serverId, knights.serverId])).toEqual({
        input: { serverIds: [gang.serverId, knights.serverId], title: "Maintenance", body: "Line one\nLine two", severity: "warning", expiresAt: null },
    });
    expect(noticeInput(form, [])).toEqual({ error: "Choose at least one server." });
    expect(noticeInput(form, Array.from({ length: 501 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`))).toEqual({ error: "A notice can target at most 500 servers." });
    expect(noticeInput({ ...form, title: "Two\nlines" }, [gang.serverId])).toEqual({ error: "The title must be one line of 1 to 120 characters." });
    expect(noticeInput({ ...form, body: "x".repeat(2_001) }, [gang.serverId])).toEqual({ error: "The message must be 1 to 2000 characters of plain text." });
    // The control plane refuses any control or format character in a reason, C1 and zero-width ones included.
    for (const character of ["\u0085", "\u200b"]) {
        expect(noticeInput({ ...form, reason: `Planned${character}work` }, [gang.serverId])).toEqual({ error: "The reason must be one line of at most 1000 characters." });
    }
    const now = Date.parse("2026-10-18T12:00:00.000Z");
    const expiry = localDateTimeToUtc("2026-10-20T08:30")!;
    expect(expiry).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/u);
    expect(Date.parse(expiry)).toBe(new Date(2026, 9, 20, 8, 30).getTime());
    expect(noticeInput({ ...form, expiresAt: "2026-10-20T08:30" }, [gang.serverId], now)).toMatchObject({ input: { expiresAt: expiry } });
    expect(noticeInput({ ...form, expiresAt: "2026-10-01T08:30" }, [gang.serverId], now)).toEqual({ error: "The expiry must be in the future and within a year." });
    expect(noticeInput({ ...form, expiresAt: "2028-10-01T08:30" }, [gang.serverId], now)).toEqual({ error: "The expiry must be in the future and within a year." });
    expect(localDateTimeToUtc("tomorrow")).toBeNull();
    expect(noticeTargetSummary(moved)).toBe("March, +29 more");
    expect(noticeTargetSummary(maintenance)).toBe("The Gang, Calradian Knights");
});

it("keeps one request ID per notice until it is confirmed or changed", () => {
    const input = { serverIds: [knights.serverId, gang.serverId], title: "Maintenance", body: "Tonight", severity: "info" as const, expiresAt: null };
    const ids = ["first", "second"];
    const first = noticeRequestId(input, null, () => ids.shift()!);
    expect(first.requestId).toBe("first");
    expect(noticeRequestId({ ...input, serverIds: [gang.serverId, knights.serverId] }, first)).toBe(first);
    expect(noticeRequestId({ ...input, title: "Changed" }, first, () => ids.shift()!).requestId).toBe("second");
});

it("lists notices with their reach, pages older ones and withdraws after confirmation", async () => {
    await act(async () => root.render(<NoticesView data={data} />));

    const card = (title: string) => container.querySelector<HTMLElement>(`article[aria-label="${title}"]`)!;
    expect(calls("notices")[0]?.input).toEqual({ cursor: null, limit: 25 });
    expect(card("Maintenance tonight").textContent).toContain("Active");
    expect(card("Maintenance tonight").querySelector("p.whitespace-pre-wrap")?.textContent).toBe("First line\nSecond line");
    expect(card("Maintenance tonight").textContent).toContain("On The Gang, Calradian Knights");
    expect(card("Server moved").textContent).toContain("Move completed");
    expect(card("Server moved").textContent).toContain("On March, +29 more");

    await act(async () => button(container, "Load older notices").click());
    expect(calls("notices")[1]?.input).toEqual({ cursor: "older", limit: 25 });
    expect(card("Older notice").textContent).toContain("Expired");
    expect(button(card("Older notice"), "Withdraw")).toBeUndefined();

    mocks.confirm.mockReturnValueOnce(false);
    await act(async () => button(card("Maintenance tonight"), "Withdraw").click());
    expect(calls("withdraw-notice")).toHaveLength(0);
    await act(async () => button(card("Maintenance tonight"), "Withdraw").click());
    expect(String(mocks.confirm.mock.calls[1]?.[0])).toContain("disappears for everyone on 2 servers' pages");
    expect(calls("withdraw-notice")[0]?.input).toEqual({ noticeId: maintenance.noticeId });
    expect(card("Maintenance tonight").textContent).toContain("Withdrawn");
    expect(button(card("Maintenance tonight"), "Withdraw")).toBeUndefined();
});

it("searches servers, selects many and posts one replay-safe notice", async () => {
    await act(async () => root.render(<NoticesView data={data} />));
    await act(async () => button(container, "Select all shown").click());
    expect(container.textContent).toContain("2 selected of at most 500");

    await type("#notice-server-search", "march");
    await act(async () => button(container, "Search").click());
    expect(calls("servers")[0]?.input).toEqual({ filter: { query: "march" }, cursor: null, limit: 100 });
    await act(async () => option("March").click());
    expect(container.textContent).toContain("3 selected of at most 500");
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Remove Calradian Knights"]')!.click());
    expect(container.textContent).toContain("2 selected of at most 500");

    await type('input[name="title"]', "Maintenance tonight");
    await type('textarea[name="body"]', "The host restarts at 22:00 UTC.");
    const respond = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (request: { operation: string }) => {
        if (request.operation === "create-notice") throw new ControlPlaneAdminError("control_plane_unavailable", "The control plane could not be reached.", true);
        return respond(request);
    });
    await post();
    expect(String(mocks.confirm.mock.calls[0]?.[0])).toContain("at the top of 2 servers' pages");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("The control plane could not be reached.");

    mocks.request.mockImplementation(respond);
    await post();
    const [first, retry] = calls("create-notice");
    expect(retry?.requestId).toBe(first?.requestId);
    expect(retry?.input).toEqual({ serverIds: [gang.serverId, march.serverId], title: "Maintenance tonight", body: "The host restarts at 22:00 UTC.", severity: "info", expiresAt: null });
    expect(container.textContent).toContain("Notice created for 2 servers.");
    expect(container.textContent).toContain("0 selected of at most 500");
    expect(container.querySelector<HTMLInputElement>('input[name="title"]')!.value).toBe("");
    expect(calls("notices")).toHaveLength(2);

    await act(async () => option("March").click());
    await type('input[name="title"]', "Maintenance tonight");
    await type('textarea[name="body"]', "The host restarts at 22:00 UTC.");
    await post();
    expect(calls("create-notice")[2]?.requestId).not.toBe(first?.requestId);
});

it("explains why a notice cannot be posted without contacting the control plane", async () => {
    await act(async () => root.render(<NoticesView data={data} />));
    await type('input[name="title"]', "Maintenance");
    await type('textarea[name="body"]', "Tonight");
    await post();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Choose at least one server.");
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(calls("create-notice")).toHaveLength(0);
});
