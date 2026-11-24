import assert from "node:assert/strict";
import test from "node:test";
import { readingErrorMessage, type ReadingTimeout } from "./use-polling";

test("a failed read names its timeout, else its own error, else a neutral cause", () => {
    const timeout: ReadingTimeout = { milliseconds: 15_000, message: "Billing readings timed out." };
    const cases: Array<[string, unknown, boolean, ReadingTimeout | undefined, string]> = [
        ["deadline passed", new Error("aborted"), true, timeout, "Billing readings timed out."],
        ["aborted without a deadline", new Error("aborted"), true, undefined, "aborted"],
        ["ordinary failure", new Error("Billing provider down."), false, timeout, "Billing provider down."],
        ["error without a message", new Error(""), false, timeout, "The reading could not be loaded."],
        ["non-error rejection", "nope", false, timeout, "The reading could not be loaded."],
    ];
    for (const [name, error, timedOut, deadline, expected] of cases) assert.equal(readingErrorMessage(error, timedOut, deadline), expected, name);
});
