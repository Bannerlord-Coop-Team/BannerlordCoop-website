import assert from "node:assert/strict";
import test from "node:test";
import { readingErrorMessage, readWithinDeadline, type ReadingSpec, type ReadingTimeout } from "./use-polling";

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

/** A spec whose read hangs until its signal aborts, recording the signal it was given. */
function hangingSpec() {
    const signals: AbortSignal[] = [];
    const spec: ReadingSpec<string> = {
        interval: 1_000,
        timeout: { milliseconds: 500, message: "Timed out." },
        read: (signal) => new Promise((_resolve, reject) => {
            signals.push(signal);
            signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    };
    return { spec, signals };
}

test("a read cut short by its deadline reports the timeout message", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const { spec } = hangingSpec();
    const outcome = readWithinDeadline(spec, new AbortController().signal);
    context.mock.timers.tick(500);
    assert.deepEqual(await outcome, { ok: false, error: "Timed out." });
});

test("a read aborted from outside reports its own error, not the timeout", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const { spec } = hangingSpec();
    const controller = new AbortController();
    const outcome = readWithinDeadline(spec, controller.signal);
    controller.abort();
    assert.deepEqual(await outcome, { ok: false, error: "aborted" });
});

test("a successful read clears its deadline", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const signals: AbortSignal[] = [];
    const spec: ReadingSpec<string> = { interval: 1_000, timeout: { milliseconds: 500, message: "Timed out." }, read: async (signal) => { signals.push(signal); return "reading"; } };
    assert.deepEqual(await readWithinDeadline(spec, new AbortController().signal), { ok: true, result: "reading" });
    context.mock.timers.tick(1_000);
    assert.equal(signals[0]!.aborted, false);
});
