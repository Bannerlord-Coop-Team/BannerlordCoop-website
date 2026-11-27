import assert from "node:assert/strict";
import test from "node:test";
import { withAccessToken } from "./access-token";

/** A request stub that records its calls and echoes the token it was sent. */
function recordingRequest() {
    const calls: Array<[string, AbortSignal]> = [];
    const request = async (accessToken: string, signal: AbortSignal) => { calls.push([accessToken, signal]); return `read with ${accessToken}`; };
    return { calls, request };
}

test("sends the request with the looked-up token and the poller's signal", async () => {
    const { calls, request } = recordingRequest();
    const signal = new AbortController().signal;
    assert.equal(await withAccessToken(async () => "test-token", request)(signal), "read with test-token");
    assert.deepEqual(calls, [["test-token", signal]]);
});

test("fails with an authentication error and sends nothing when signed out", async () => {
    const { calls, request } = recordingRequest();
    await assert.rejects(withAccessToken(async () => null, request)(new AbortController().signal), { message: "Authentication is required." });
    assert.equal(calls.length, 0);
});

test("rejects with the abort and sends nothing when the poll was cancelled during the token lookup", async () => {
    const { calls, request } = recordingRequest();
    const controller = new AbortController();
    const read = withAccessToken(async () => { controller.abort(); return "test-token"; }, request);
    await assert.rejects(read(controller.signal), { name: "AbortError" });
    assert.equal(calls.length, 0);
});
