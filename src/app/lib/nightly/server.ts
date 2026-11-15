import "server-only";
import { createNightlyClient, type NightlyClient, type NightlyFetch } from "./client";
import { readNightlyConfig } from "./config";
import { reportConfigInvalid, type NightlyLogger } from "./diagnostics";

// Wrapped rather than passed bare: Workers throw "Illegal invocation" when fetch is called with a foreign `this`.
const globalFetch: NightlyFetch = (input, init) => fetch(input, init);
const logError: NightlyLogger = (entry) => console.error(entry);

/** Composition root: wires the nightly client to the Worker's server-only env, the global fetch and console logging. */
export function getNightlyClient(): NightlyClient {
    const result = readNightlyConfig({
        NIGHTLY_FUNCTION_URL: process.env.NIGHTLY_FUNCTION_URL,
        NIGHTLY_WEBSITE_KEY: process.env.NIGHTLY_WEBSITE_KEY,
        NODE_ENV: process.env.NODE_ENV,
    });
    if (result.ok) return createNightlyClient(result.config, globalFetch, logError);
    reportConfigInvalid(logError, result.setting);
    return createNightlyClient(null, globalFetch, logError);
}
