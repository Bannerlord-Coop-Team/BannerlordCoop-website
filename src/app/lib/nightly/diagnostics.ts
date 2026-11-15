import type { NightlySetting } from "./config";

/** A structured log sink; entries name routes, statuses and codes, never bodies or secret values. */
export type NightlyLogger = (entry: Readonly<Record<string, string | number>>) => void;

/** Logs which Edge Function setting is missing or invalid, by name only. */
export function reportConfigInvalid(log: NightlyLogger, setting: NightlySetting): void {
    log({ event: "nightly_config_invalid", setting });
}

/** Logs a call that got no response (network error or timeout) with the error's class name only. */
export function reportUnreachable(log: NightlyLogger, path: string, error: unknown): void {
    log({ event: "nightly_function_unreachable", path, error: errorName(error) });
}

/** Logs a server-side failure status with its sanitized error code. */
export function reportFailed(log: NightlyLogger, path: string, status: number, code: string): void {
    log({ event: "nightly_function_failed", path, status, code });
}

/** Logs a success reply whose body could not be read or does not match the contract. */
export function reportInvalidResponse(log: NightlyLogger, path: string): void {
    log({ event: "nightly_function_invalid_response", path });
}

/** The error's class name only; messages can echo URLs or upstream text. */
function errorName(error: unknown): string {
    if (error instanceof Error) return error.name;
    return typeof error;
}
