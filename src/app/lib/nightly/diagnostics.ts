import type { NightlyFetch } from "./client";

/** A structured log sink; entries never carry secret values. */
export type NightlyLogger = (entry: Record<string, string>) => void;

/** Logs that the Edge Function settings are missing or invalid, naming no values. */
export function reportConfigInvalid(log: NightlyLogger): void {
    log({ event: "nightly_config_invalid" });
}

/** Wraps a fetcher so a network error or timeout is logged with the route path and error name, then rethrown. */
export function loggingFetch(fetcher: NightlyFetch, functionUrl: string, log: NightlyLogger): NightlyFetch {
    return async (input, init) => {
        try {
            return await fetcher(input, init);
        } catch (error) {
            log({ event: "nightly_function_unreachable", path: routePath(input, functionUrl), error: errorName(error) });
            throw error;
        }
    };
}

/** The contract route of a call URL, without the function URL's project host. */
function routePath(input: string, functionUrl: string): string {
    if (!input.startsWith(functionUrl)) return "unknown";
    return input.slice(functionUrl.length);
}

/** The error's class name only; messages can echo URLs or upstream text. */
function errorName(error: unknown): string {
    if (error instanceof Error) return error.name;
    return typeof error;
}
