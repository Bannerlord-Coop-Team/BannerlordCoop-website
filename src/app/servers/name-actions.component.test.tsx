import { beforeEach, expect, it, vi } from "vitest";
import { createTranslator } from "@/app/lib/localization/translator";
import messages from "@/app/lib/localization/dictionaries/en/managed-server.json";
import { renameLiveServer } from "./name-actions";

const mocks = vi.hoisted(() => ({ server: vi.fn(), user: vi.fn(), access: vi.fn(), save: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/app/lib/console/servers", () => ({ getLiveConsoleServer: mocks.server }));
vi.mock("@/app/lib/auth/access", () => ({ getLiveConsoleAccessLevel: mocks.access }));
vi.mock("@/app/lib/hosting/server-settings", () => ({ saveServerDisplayName: mocks.save }));
vi.mock("@/app/lib/supabase/server", () => ({
    // Retains the action's real authentication branch with a controlled session source.
    getSupabaseServerClient: async () => ({ auth: { getUser: mocks.user } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/app/lib/localization/server", () => ({
    // Distinct strings prove action errors use the injected request translator.
    getTranslations: async () => createTranslator("en", {
        ...messages, "name.required": "Localized required name", "name.tooLong": "Localized limit: {maximum}",
        "name.invalidServer": "Localized invalid server", "name.signIn": "Localized sign in", "name.forbidden": "Localized denied",
    }),
}));

// Constructs the existing form contract without introducing localization transport fields.
function form(displayName: string) {
    const data = new FormData();
    data.set("serverId", "live-id");
    data.set("displayName", displayName);
    return data;
}

// Establishes an authorized request; individual paths change only their relevant input.
beforeEach(() => {
    vi.clearAllMocks();
    mocks.server.mockReturnValue({ id: "live-id" });
    mocks.user.mockResolvedValue({ data: { user: { id: "actor" } } });
    mocks.access.mockReturnValue("owner");
    mocks.save.mockResolvedValue(undefined);
});

// Rejects invalid names before authentication or mutation with localized validation messages.
it.each([["", "Localized required name"], ["a".repeat(81), "Localized limit: 80"]])("localizes invalid display name %s", async (name, error) => {
    expect(await renameLiveServer(form(name))).toEqual({ ok: false, error });
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
});

// Preserves invalid-server, authentication and role guards before any write.
it.each(["server", "session", "role"])("preserves the %s authorization guard", async (guard) => {
    if (guard === "server") mocks.server.mockReturnValue(null);
    if (guard === "session") mocks.user.mockResolvedValue({ data: { user: null } });
    if (guard === "role") mocks.access.mockReturnValue("operator");
    const errors = { server: "Localized invalid server", session: "Localized sign in", role: "Localized denied" };
    expect(await renameLiveServer(form("Campaign"))).toEqual({ ok: false, error: errors[guard as keyof typeof errors] });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
});

// Saves only the original normalized user value and existing actor/server identity.
it("preserves mutation inputs and revalidation on an authorized rename", async () => {
    expect(await renameLiveServer(form("  Real   {name}  "))).toEqual({ ok: true, displayName: "Real {name}" });
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ displayName: "Real {name}", serverId: "live-id", updatedBy: "actor" });
    expect(mocks.revalidate.mock.calls).toEqual([["/servers"], ["/servers/live-id"]]);
});
