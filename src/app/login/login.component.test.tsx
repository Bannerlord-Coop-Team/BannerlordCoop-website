import { act, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/app/components/auth/LoginForm";
import { LocalizationProvider } from "@/app/lib/localization/client";
import login from "@/app/lib/localization/dictionaries/en/login.json";
import { localeDefinitions } from "@/app/lib/localization/registry";
import type { Dictionary } from "@/app/lib/localization/types";
import LoginPage, { generateMetadata } from "./page";
import LoginLoading from "./loading";

const mocks = vi.hoisted(() => ({
    cookie: undefined as string | undefined,
    oauth: vi.fn(),
    otp: vi.fn(),
    configurationFailure: false,
    client: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: mocks.cookie }) }) }));
vi.mock("@/app/lib/supabase/client", () => ({
    // Models the helper's injected diagnostic without making external authentication requests.
    getSupabaseBrowserClient: (configurationError: string) => {
        mocks.client(configurationError);
        if (mocks.configurationFailure) throw new Error(configurationError);
        return { auth: { signInWithOAuth: mocks.oauth, signInWithOtp: mocks.otp } };
    },
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const originalRussian = localeDefinitions.ru;
const roots: Root[] = [];
afterEach(async () => {
    for (const root of roots.splice(0)) await act(async () => root.unmount());
    document.body.replaceChildren();
    mocks.cookie = undefined;
    mocks.configurationFailure = false;
    vi.resetAllMocks();
    localeDefinitions.ru = originalRussian;
});

/** Supplies reordered translated fixture data without enabling any production locale. */
function translatedMessages(): Dictionary {
    return {
        ...Object.fromEntries(Object.entries(login).map(([key, value]) => [key, `Перевод: ${value}`])),
        "emailSent.description": "{email} — ссылка отправлена. Используйте её один раз.",
    };
}

/** Renders the form with exactly its page namespace and a representative callback destination. */
function form(messages: Dictionary = login, initialError?: string) {
    return <LocalizationProvider locale="ru" messages={{ login: messages }}>
        <LoginForm nextPath="/servers?tab=mine#details" initialError={initialError} />
    </LocalizationProvider>;
}

/** Mounts interactive presentation for focused auth-request and state assertions. */
async function mount(tree: ReactNode) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(tree));
    return container;
}

/** Dispatches real input events so React updates the controlled email field. */
async function enterEmail(container: HTMLElement, value: string) {
    const input = container.querySelector("input")!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

/** Submits only the existing email form without bypassing its event handler. */
async function submitEmail(container: HTMLElement) {
    await act(async () => {
        container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
}

describe("login localization", () => {
    it.each([undefined, "invalid", "ru"])("keeps English page, metadata and loading aligned for cookie %s", async (cookie) => {
        // ru stands in for any switched-off locale; afterEach restores its definition.
        if (cookie === "ru") localeDefinitions.ru = { ...originalRussian, enabled: false };
        mocks.cookie = cookie;
        const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));
        expect(html).toContain(login["form.heading"]);
        expect(html).toContain(login["hero.quote"]);
        expect(html).toContain(`alt="${login["hero.imageAlt"]}"`);
        expect(html).toContain(`aria-label="${login["navigation.homeLabel"]}"`);
        expect(html).toContain(`aria-label="${login["navigation.backHome"]}"`);
        expect(await generateMetadata()).toEqual({ title: login["metadata.title"], description: login["metadata.description"] });
        const loading = renderToStaticMarkup(await LoginLoading());
        expect(loading).toContain(`aria-label="${login["loading.label"]}"`);
        expect(loading).toContain(`role="status">${login["loading.status"]}`);
        expect(loading).toContain('aria-busy="true"');
    });

    it("uses activated dictionary data for server copy, client labels, loading and metadata", async () => {
        const translated = translatedMessages();
        localeDefinitions.ru = { ...originalRussian, enabled: true, dictionaries: { login: async () => ({ default: translated }) } };
        mocks.cookie = "ru";
        const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ error: ["external diagnostic", "ignored"] }) }));
        for (const key of ["hero.imageAlt", "hero.quote", "hero.description", "navigation.homeLabel", "navigation.backHome", "footer.security", "form.eyebrow", "form.heading", "form.description", "form.emailAlternative", "form.emailLabel", "form.emailPlaceholder", "form.continueWithEmail"]) {
            expect(html).toContain(translated[key]);
        }
        expect(html).toContain("external diagnostic");
        expect(html).not.toContain("ignored");
        expect(await generateMetadata()).toEqual({ title: translated["metadata.title"], description: translated["metadata.description"] });
        const loading = renderToStaticMarkup(await LoginLoading());
        expect(loading).toContain(translated["loading.label"]);
        expect(loading).toContain(translated["loading.status"]);
    });

    it("hydrates the delivered namespace without English fallback or mismatch", async () => {
        const tree = form(translatedMessages());
        const container = document.createElement("div");
        container.innerHTML = renderToStaticMarkup(tree);
        const before = container.innerHTML;
        const recover = vi.fn();
        await act(async () => { roots.push(hydrateRoot(container, tree, { onRecoverableError: recover })); });
        expect(container.innerHTML).toBe(before);
        expect(recover).not.toHaveBeenCalled();
    });

    it.each(["google", "discord"])("preserves %s OAuth and callback values while localizing pending presentation", async (provider) => {
        mocks.oauth.mockReturnValue(new Promise(() => {}));
        const translated = translatedMessages();
        const container = await mount(form(translated));
        const buttons = container.querySelectorAll<HTMLButtonElement>('button[type="button"]');
        await act(async () => buttons[provider === "google" ? 0 : 1].click());
        expect(mocks.oauth).toHaveBeenCalledWith({
            provider,
            options: { redirectTo: `${window.location.origin}/auth/callback?next=%2Fservers%3Ftab%3Dmine%23details` },
        });
        expect(container.textContent).toContain(translated["provider.connecting"]);
        expect([...container.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
        expect(container.querySelector("input")!.disabled).toBe(true);
    });

    it("preserves the first next query value and callback path without a destination", async () => {
        mocks.oauth.mockResolvedValue({ error: null });
        const container = await mount(await LoginPage({ searchParams: Promise.resolve({ next: ["/account?tab=profile#name", "/ignored"] }) }));
        await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
        expect(mocks.oauth.mock.calls[0][0].options.redirectTo).toBe(`${window.location.origin}/auth/callback?next=%2Faccount%3Ftab%3Dprofile%23name`);
        const plain = await mount(<LocalizationProvider locale="en" messages={{ login }}><LoginForm /></LocalizationProvider>);
        await act(async () => plain.querySelector<HTMLButtonElement>("button")!.click());
        expect(mocks.oauth.mock.calls[1][0].options.redirectTo).toBe(`${window.location.origin}/auth/callback`);
    });

    it("localizes email pending and rich success messages without changing the OTP payload or user content", async () => {
        let resolveOtp!: (result: { error: null }) => void;
        mocks.otp.mockReturnValue(new Promise((resolve) => { resolveOtp = resolve; }));
        const translated = translatedMessages();
        const container = await mount(form(translated));
        const email = "commander+{email}@example.com";
        await enterEmail(container, email);
        expect(container.querySelector('label[for="email"]')!.textContent).toBe(translated["form.emailLabel"]);
        expect(container.textContent).toContain(translated["form.security"]);
        await submitEmail(container);
        expect(mocks.otp).toHaveBeenCalledWith({
            email,
            options: {
                emailRedirectTo: `${window.location.origin}/auth/callback?next=%2Fservers%3Ftab%3Dmine%23details`,
                shouldCreateUser: true,
            },
        });
        expect(container.querySelector('button[type="submit"]')!.textContent).toBe(translated["form.sendingLink"]);
        await act(async () => resolveOtp({ error: null }));
        expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
        expect(container.textContent).toContain(translated["emailSent.eyebrow"]);
        expect(container.querySelector("h1")!.textContent).toBe(translated["emailSent.heading"]);
        expect(container.querySelector("strong")!.textContent).toBe(email);
        expect(container.querySelector("strong")!.parentElement!.textContent).toBe(`${email} — ссылка отправлена. Используйте её один раз.`);
        expect(container.querySelector("button")!.textContent).toBe(translated["emailSent.useDifferentEmail"]);
        await act(async () => container.querySelector("button")!.click());
        expect(container.querySelector("input")!.value).toBe("");
        expect(container.querySelector("h1")!.textContent).toBe(translated["form.heading"]);
    });

    it("localizes unknown failures and restores controls for provider and email actions", async () => {
        mocks.oauth.mockRejectedValue({ code: "external_code" });
        mocks.otp.mockResolvedValue({ error: { code: "external_code" } });
        const translated = translatedMessages();
        const container = await mount(form(translated));
        await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
        expect(container.querySelector('[role="alert"]')!.textContent).toBe(translated["error.generic"]);
        expect(container.querySelector("button")!.disabled).toBe(false);
        await enterEmail(container, "commander@example.com");
        await submitEmail(container);
        expect(container.querySelector('[role="alert"]')!.textContent).toBe(translated["error.generic"]);
        expect(container.querySelector("input")!.disabled).toBe(false);
    });

    it.each(["provider", "email"])("shows the injected localized configuration error for %s sign-in", async (action) => {
        mocks.configurationFailure = true;
        const translated = translatedMessages();
        const container = await mount(form(translated));
        if (action === "email") {
            await enterEmail(container, "commander@example.com");
            await submitEmail(container);
        } else {
            await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
        }
        expect(mocks.client).toHaveBeenCalledWith(translated["error.configuration"]);
        expect(container.querySelector('[role="alert"]')!.textContent).toBe(translated["error.configuration"]);
        expect(container.querySelector("button")!.disabled).toBe(false);
        expect(mocks.oauth).not.toHaveBeenCalled();
        expect(mocks.otp).not.toHaveBeenCalled();
    });

    it("retains external query and provider error text as escaped source content", async () => {
        const diagnostic = "<script>{email}</script> provider diagnostic";
        const container = await mount(form(translatedMessages(), diagnostic));
        expect(container.querySelector('[role="alert"]')!.textContent).toBe(diagnostic);
        expect(container.querySelector("script")).toBeNull();
        mocks.oauth.mockResolvedValue({ error: new Error(diagnostic) });
        await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
        expect(container.querySelector('[role="alert"]')!.textContent).toBe(diagnostic);
        expect(container.querySelector("script")).toBeNull();
    });
});
