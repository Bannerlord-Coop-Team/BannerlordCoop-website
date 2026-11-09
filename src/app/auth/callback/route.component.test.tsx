import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import login from "@/app/lib/localization/dictionaries/en/login.json";
import { localeDefinitions } from "@/app/lib/localization/registry";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ cookie: undefined as string | undefined, cookies: vi.fn(), exchange: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/app/lib/supabase/server", () => ({
    getSupabaseServerClient: async () => ({ auth: { exchangeCodeForSession: mocks.exchange } }),
}));
const originalRussian = localeDefinitions.ru;
const translatedError = "Не удалось войти. Повторите попытку.";

afterEach(() => {
    localeDefinitions.ru = originalRussian;
    mocks.cookie = undefined;
    vi.resetAllMocks();
});

/** Supplies an enabled request-locale fixture without changing production activation. */
function useRequestLocale(cookie?: string) {
    mocks.cookie = cookie;
    mocks.cookies.mockImplementation(async () => ({ get: () => ({ value: mocks.cookie }) }));
    localeDefinitions.ru = {
        ...originalRussian,
        enabled: true,
        dictionaries: { login: async () => ({ default: { ...login, "error.callback": translatedError } }) },
    };
}

/** Executes a callback locally and returns its redirect URL for query-preservation assertions. */
async function callback(params: Record<string, string>) {
    const response = await GET(new NextRequest(`https://coop.example/auth/callback?${new URLSearchParams(params)}`));
    expect(response.status).toBe(307);
    return new URL(response.headers.get("location")!);
}

describe("localized auth callback", () => {
    it.each([undefined, "invalid", "ja", "ru"])("uses request-localized fallback for cookie %s", async (cookie) => {
        // ja stands in for any switched-off locale, which must fall back to English.
        const originalJapanese = localeDefinitions.ja;
        if (cookie === "ja") localeDefinitions.ja = { ...originalJapanese, enabled: false };
        onTestFinished(() => { localeDefinitions.ja = originalJapanese; });
        useRequestLocale(cookie);
        const url = await callback({ next: "/servers?tab=mine#details" });
        expect(url.origin + url.pathname).toBe("https://coop.example/login");
        expect(url.searchParams.get("error")).toBe(cookie === "ru" ? translatedError : login["error.callback"]);
        expect(url.searchParams.get("next")).toBe("/servers?tab=mine#details");
        expect(mocks.exchange).not.toHaveBeenCalled();
    });

    it.each(["", "<script>{email}</script> Ошибка & detail"])("preserves raw provider description %j without loading translations", async (description) => {
        const request = new NextRequest(`https://coop.example/auth/callback?${new URLSearchParams({ error_description: description, next: "/account?tab=profile#name" })}&error_description=ignored`);
        const response = await GET(request);
        const url = new URL(response.headers.get("location")!);
        expect(url.searchParams.get("error")).toBe(description);
        expect(url.searchParams.get("next")).toBe("/account?tab=profile#name");
        expect(mocks.cookies).not.toHaveBeenCalled();
    });

    it("preserves successful exchange and destination without resolving a locale", async () => {
        mocks.exchange.mockResolvedValue({ error: null });
        const url = await callback({ code: "opaque-code", next: "/account?tab=profile#name", error_description: "ignored on success" });
        expect(url.href).toBe("https://coop.example/account?tab=profile#name");
        expect(mocks.exchange).toHaveBeenCalledWith("opaque-code");
        expect(mocks.cookies).not.toHaveBeenCalled();
    });

    it.each(["returned", "thrown"])("localizes website fallback after %s exchange failure", async (failure) => {
        useRequestLocale("ru");
        if (failure === "returned") mocks.exchange.mockResolvedValue({ error: new Error("existing exchange diagnostic") });
        else mocks.exchange.mockRejectedValue(new Error("existing exchange diagnostic"));
        const url = await callback({ code: "opaque-code", next: "/servers?tab=mine#details" });
        expect(url.pathname).toBe("/login");
        expect(url.searchParams.get("error")).toBe(translatedError);
        expect(url.searchParams.get("next")).toBe("/servers?tab=mine#details");
        expect(mocks.exchange).toHaveBeenCalledWith("opaque-code");
    });

    it.each(["https://evil.example/account", "//evil.example/account", "/"])("keeps root fallback and omits next for %s", async (next) => {
        useRequestLocale("ru");
        const url = await callback({ next });
        expect(url.origin + url.pathname).toBe("https://coop.example/login");
        expect(url.searchParams.get("error")).toBe(translatedError);
        expect(url.searchParams.has("next")).toBe(false);
    });

    it.each([
        "%2F%2Fevil.example%2Faccount",
        "https%3A%2F%2Fevil.example%2Faccount",
        "%2F%5Cevil.example%2Faccount",
        "%2Fadmin%0D%0A",
        "%2Fadmin%0D%0ALocation%3A%20https%3A%2F%2Fevil.example",
        "%2F%09%2Fevil.example",
        "%2Fadmin%00",
        "%2Fadmin%7F",
    ])("rejects an adversarial encoded next after successful sign-in: %s", async encodedNext => {
        mocks.exchange.mockResolvedValue({ error: null });
        const response = await GET(new NextRequest(`https://coop.example/auth/callback?code=fixture-code&next=${encodedNext}`));
        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toBe("https://coop.example/");
        expect(mocks.exchange).toHaveBeenCalledExactlyOnceWith("fixture-code");
    });

    it.each([
        ["%2F%252F%252Fevil.example%2Faccount", "/%2F%2Fevil.example/account"],
        ["%2F%255C%255Cevil.example%2Faccount", "/%5C%5Cevil.example/account"],
        ["%2Fadmin%3Fq%3D%252F%252Fevil.example%250D%250A", "/admin?q=%2F%2Fevil.example%0D%0A"],
    ])("keeps another encoding layer inside the same origin: %s", async (encodedNext, path) => {
        mocks.exchange.mockResolvedValue({ error: null });
        const response = await GET(new NextRequest(`https://coop.example/auth/callback?code=fixture-code&next=${encodedNext}`));
        const location = response.headers.get("location")!;
        expect(new URL(location).origin).toBe("https://coop.example");
        expect(location).toBe(`https://coop.example${path}`);
        expect(location).not.toMatch(/[\r\n\t\\]/u);
    });
});
