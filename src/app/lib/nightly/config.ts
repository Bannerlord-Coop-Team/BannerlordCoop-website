/** Server-only settings the website needs to reach the nightly-gateway Edge Function. */
export type NightlyConfig = { functionUrl: string; websiteKey: string };

export type NightlyEnvironment = {
    NIGHTLY_FUNCTION_URL?: string;
    NIGHTLY_WEBSITE_KEY?: string;
    NODE_ENV?: string;
};

/** The name of a nightly setting; diagnostics may log it, never its value. */
export type NightlySetting = "NIGHTLY_FUNCTION_URL" | "NIGHTLY_WEBSITE_KEY";

export type NightlyConfigResult = { ok: true; config: NightlyConfig } | { ok: false; setting: NightlySetting };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Reads and validates the Edge Function settings; a failure names the first invalid setting so the pages fail closed. */
export function readNightlyConfig(environment: NightlyEnvironment): NightlyConfigResult {
    const functionUrl = normalizeFunctionUrl(environment.NIGHTLY_FUNCTION_URL, environment.NODE_ENV);
    if (functionUrl === null) return { ok: false, setting: "NIGHTLY_FUNCTION_URL" };
    const websiteKey = environment.NIGHTLY_WEBSITE_KEY?.trim();
    if (!websiteKey) return { ok: false, setting: "NIGHTLY_WEBSITE_KEY" };
    return { ok: true, config: { functionUrl, websiteKey } };
}

/** Accepts an https URL without credentials, query or fragment (loopback http only under next dev). */
function normalizeFunctionUrl(raw: string | undefined, nodeEnv: string | undefined): string | null {
    const value = raw?.trim();
    if (!value) return null;
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return null;
    }
    if (url.username || url.password || url.search || url.hash) return null;
    const loopbackDevelopment = nodeEnv === "development" && url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
    if (url.protocol !== "https:" && !loopbackDevelopment) return null;
    return url.href.replace(/\/+$/u, "");
}
