import "server-only";
import { createNightlyClient, type NightlyClient } from "./client";
import { readNightlyConfig } from "./config";

/** Composition root: wires the nightly client to the Worker's server-only env and the global fetch. */
export function getNightlyClient(): NightlyClient {
    const config = readNightlyConfig({
        NIGHTLY_FUNCTION_URL: process.env.NIGHTLY_FUNCTION_URL,
        NIGHTLY_WEBSITE_KEY: process.env.NIGHTLY_WEBSITE_KEY,
        NODE_ENV: process.env.NODE_ENV,
    });
    return createNightlyClient(config, (input, init) => fetch(input, init));
}
