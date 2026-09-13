import assert from "node:assert/strict";
import test from "node:test";
import { boundedConsoleText, parseConsoleEvent } from "./ManagedServerConsole";
import { consoleStreamEndpoint } from "../../api/servers/[serverId]/console/route";

test("parses only typed bounded line events", () => {
    assert.deepEqual(parseConsoleEvent('event: line\ndata: "hello"'), { type: "line", text: "hello" });
    assert.deepEqual(parseConsoleEvent("event: line\ndata: not-json"), { type: "ignored" });
    assert.deepEqual(parseConsoleEvent("event: truncated\ndata: {}"), { type: "truncated" });
});

test("allows only the configured HTTPS Oracle origin", () => {
    assert.equal(consoleStreamEndpoint("https://control.example.com").href, "https://control.example.com/v1/user/console-stream");
    assert.throws(() => consoleStreamEndpoint("http://control.example.com"));
    assert.throws(() => consoleStreamEndpoint("https://control.example.com/other"));
    assert.throws(() => consoleStreamEndpoint("https://user:pass@control.example.com"));
});

test("bounds retained browser output", () => {
    let output = "";
    for (let index = 0; index < 2_100; index += 1) output = boundedConsoleText(output, `line-${index}`);
    assert.ok(output.length <= 128 * 1_024);
    assert.ok(output.split("\n").length <= 2_000);
    assert.ok(output.includes("line-2099"));
    assert.ok(!output.includes("line-0\n"));
});
