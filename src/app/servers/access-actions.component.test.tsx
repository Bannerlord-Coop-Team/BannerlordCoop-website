import type { User } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";
import { createTranslator } from "@/app/lib/localization/translator";
import messages from "@/app/lib/localization/dictionaries/en/live-server.json";
import { addLiveConsoleOperator, removeLiveConsoleOperator } from "./access-actions";

const mocks = vi.hoisted(() => ({
    getUser: vi.fn(), users: vi.fn(), update: vi.fn(), getUserById: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("next/navigation", () => ({
    // Terminate redirects without executing a real request or changing routing behavior.
    redirect: (url: string) => { throw new Error(`redirect:${url}`); },
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/app/lib/localization/server", () => ({
    // Exercise real named-key interpolation with data-only translated action messages.
    getTranslations: async () => createTranslator("es", {
        ...messages, "action.added": "Acceso añadido.", "action.removed": "Acceso eliminado.",
    }),
}));
vi.mock("@/app/lib/supabase/server", () => ({ getSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/app/lib/supabase/admin", () => ({ getSupabaseAdminClient: () => ({ auth: { admin: { getUserById: mocks.getUserById } } }) }));
vi.mock("@/app/lib/supabase/users", () => ({ listSupabaseUsers: mocks.users }));
vi.mock("@/app/lib/console/assignment", () => ({ updateLiveConsoleAssignment: mocks.update }));
vi.mock("@/app/lib/console/servers", () => ({ getLiveConsoleServer: (id: string) => id === "live" ? { id } : null }));

/** Builds accounts with real role/assignment metadata for the unchanged permission helpers. */
function member(id: string, assignment: "owner" | "operator" | null = null): User {
    return { id, email: `${id}@example.test`, user_metadata: {}, app_metadata: {
        role: "User", ...(assignment ? { [`live_console_${assignment}_server_ids`]: ["live"] } : {}),
    } } as unknown as User;
}
/** Constructs the same form fields submitted by the live access manager. */
function form(values: Record<string, string> = {}) {
    const data = new FormData();
    for (const [key, value] of Object.entries({ serverId: "live", accountEmail: " TARGET@example.test ", operatorUserId: "target", ...values })) data.set(key, value);
    return data;
}
/** Asserts the exact redirect query and anchor while keeping translated text out of operation inputs. */
function destination(message: string, success = false) {
    return `redirect:/servers/live?${new URLSearchParams({ [success ? "accessUpdated" : "accessError"]: message })}#server-access`;
}

beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: member("owner", "owner") } });
    mocks.users.mockResolvedValue({ users: [member("owner", "owner"), member("target")], truncated: false });
    mocks.getUserById.mockResolvedValue({ data: { user: member("target", "operator") }, error: null });
});

it.each([addLiveConsoleOperator, removeLiveConsoleOperator])("preserves anonymous login and operator authorization gates", async (action) => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    await expect(action(form())).rejects.toThrow("redirect:/login?next=%2Fservers%2Flive");
    mocks.getUser.mockResolvedValue({ data: { user: member("actor", "operator") } });
    await expect(action(form())).rejects.toThrow("redirect:/servers");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.users).not.toHaveBeenCalled();
    expect(mocks.getUserById).not.toHaveBeenCalled();
});

it("adds an operator with translated feedback, normalized email and unchanged assignment payload", async () => {
    await expect(addLiveConsoleOperator(form())).rejects.toThrow(destination("Acceso añadido.", true));
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(expect.anything(), "target", "live", { operator: true });
    expect(mocks.revalidate.mock.calls).toEqual([["/servers"], ["/servers/live"]]);
});

it("removes an operator with translated feedback and unchanged assignment payload", async () => {
    await expect(removeLiveConsoleOperator(form())).rejects.toThrow(destination("Acceso eliminado.", true));
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(expect.anything(), "target", "live", { operator: false });
    expect(mocks.getUserById).toHaveBeenCalledExactlyOnceWith("target");
});

it.each([
    [[], false, "action.missingAccount"],
    [[member("owner", "owner"), member("target")], true, "action.directoryTooLarge"],
    [[member("target")], false, "action.uniqueOwnerRequired"],
    [[member("target", "owner")], false, "action.ownerHasAccess"],
    [[member("owner", "owner"), { ...member("target"), app_metadata: { role: "Admin" } }], false, "action.adminHasAccess"],
] as const)("preserves add-operator validation (%s)", async (users, truncated, key) => {
    mocks.users.mockResolvedValue({ users, truncated });
    await expect(addLiveConsoleOperator(form())).rejects.toThrow(destination(messages[key]));
    expect(mocks.update).not.toHaveBeenCalled();
});

it.each([
    [null, "action.operatorMissing"],
    [member("target"), "action.notOperator"],
] as const)("preserves remove-operator validation (%s)", async (user, key) => {
    mocks.getUserById.mockResolvedValue({ data: { user }, error: null });
    await expect(removeLiveConsoleOperator(form())).rejects.toThrow(destination(messages[key]));
    expect(mocks.update).not.toHaveBeenCalled();
});

it.each([addLiveConsoleOperator, removeLiveConsoleOperator])("preserves contention handling without exposing external error payloads", async (action) => {
    mocks.update.mockRejectedValue({ code: "55P03", message: "external private detail" });
    await expect(action(form())).rejects.toThrow(destination(messages["action.accountBusy"]));
});

it("retains invalid-input routes and owned error messages", async () => {
    await expect(addLiveConsoleOperator(form({ accountEmail: "" }))).rejects.toThrow(destination(messages["action.operatorEmail"]));
    await expect(removeLiveConsoleOperator(form({ operatorUserId: "" }))).rejects.toThrow(destination(messages["action.invalidOperator"]));
    await expect(addLiveConsoleOperator(form({ serverId: "invalid" }))).rejects.toThrow(`redirect:/servers?${new URLSearchParams({ accessError: messages["action.invalidServer"] })}#my-servers`);
    expect(mocks.getUser).not.toHaveBeenCalled();
});

it.each([
    [addLiveConsoleOperator, "action.addFailed"],
    [removeLiveConsoleOperator, "action.removeFailed"],
] as const)("uses owned fallback messages on operation failure", async (action, key) => {
    mocks.update.mockRejectedValue(new Error("external private detail"));
    await expect(action(form())).rejects.toThrow(destination(messages[key]));
});
