import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import LocalLoginPage from "../../../deploy/local/dev-login/page";
import { LocalLoginForm } from "../../../deploy/local/dev-login/LocalLoginForm";
import fixture from "../../../deploy/local/dev-login/fixture.json";

const mocks = vi.hoisted(() => ({ signInWithPassword: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not-found"); }, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: mocks }) }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it.each([
    ["production", "https://supabase-tls.localhost:8443"],
    ["development", "https://example.supabase.co"],
])("hides local login for %s with %s", (mode, url) => {
    vi.stubEnv("NODE_ENV", mode); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    expect(() => LocalLoginPage()).toThrow("not-found");
});

it("submits seeded credentials through password auth and reports actual authentication failure", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase-tls.localhost:8443");
    expect(LocalLoginPage()).toBeTruthy();
    mocks.signInWithPassword.mockResolvedValue({ error: new Error("Not seeded") });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => root.render(<LocalLoginForm />));
        await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
        expect(mocks.signInWithPassword).toHaveBeenCalledExactlyOnceWith({ email: fixture.email, password: fixture.password });
        expect(container.querySelector('[role="alert"]')!.textContent).toContain("account seed completed");
        expect(container.querySelector("button")!.disabled).toBe(false);
    } finally { await act(async () => root.unmount()); container.remove(); }
});
