import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LoginForm } from "./LoginForm";

const signInWithOAuth = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/supabase/client", () => ({
    getSupabaseBrowserClient: () => ({ auth: { signInWithOAuth } }),
}));

// Test matrix: email unavailable; provider success with continuation; provider failure permits retry.
let container: HTMLDivElement;
let root: Root;

// Creates an isolated form mount and resets the provider mock for each path.
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    root = createRoot(container);
    signInWithOAuth.mockReset();
    signInWithOAuth.mockResolvedValue({ error: null });
});

// Removes the mounted form after each behavioral path.
afterEach(async () => {
    await act(async () => root.unmount());
});

// Verifies that visitors are not offered the unavailable magic-link flow.
it("offers only Google and Discord with an email-unavailable notice", async () => {
    await act(async () => root.render(<LoginForm />));
    expect(Array.from(container.querySelectorAll("button"), button => button.textContent?.trim())).toEqual(["Google", "Discord"]);
    expect(container.querySelector("form, input")).toBeNull();
    expect(container.textContent).toContain("Email sign-in is temporarily unavailable. Please use Google or Discord.");
    expect(container.textContent).not.toContain("magic link");
    expect(signInWithOAuth).not.toHaveBeenCalled();
});

// Verifies that both remaining providers preserve the OAuth continuation and busy state.
it.each(["google", "discord"])("starts %s OAuth with the requested continuation", async provider => {
    await act(async () => root.render(<LoginForm nextPath="/servers?tab=mine" />));
    const button = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.trim().toLowerCase() === provider)!;
    await act(async () => button.click());
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", "/servers?tab=mine");
    expect(signInWithOAuth).toHaveBeenCalledWith({ provider, options: { redirectTo: callback.toString() } });
    expect(button.textContent).toContain("Connecting");
    expect(Array.from(container.querySelectorAll("button")).every(button => button.disabled)).toBe(true);
});

// Verifies that provider errors remain visible and allow another sign-in attempt.
it("shows OAuth failures and re-enables provider buttons", async () => {
    signInWithOAuth.mockResolvedValue({ error: new Error("Provider unavailable") });
    await act(async () => root.render(<LoginForm initialError="Previous callback failed" />));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Previous callback failed");
    await act(async () => container.querySelector("button")!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Provider unavailable");
    expect(Array.from(container.querySelectorAll("button")).every(button => !button.disabled)).toBe(true);
});
