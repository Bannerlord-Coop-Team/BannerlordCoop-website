// Generic structural checks shared by the closed DTO parsers on both the Edge and the website.

/** Whether a value is a plain object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether an object has exactly the expected own keys, in any order. */
export function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
    return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
