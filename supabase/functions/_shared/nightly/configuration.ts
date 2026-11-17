// Boot-time setting checks shared by the gateway and its Discord client: a length floor for secrets, and the
// configuration error, which names the invalid setting but never its value.

/** Whether a configured secret is a string of at least `minimum` characters. */
export function hasMinimumLength(value: unknown, minimum: number): boolean {
    return typeof value === "string" && value.length >= minimum;
}

/** The boot error for one implausible setting, naming the setting but never its value. */
export function configurationInvalid(setting: string): Error {
    return new Error(`nightly_gateway_configuration_invalid: ${setting}`);
}
