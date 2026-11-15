import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_GATEWAY_ORIGIN, LEGACY_GATEWAY_ORIGIN } from "./core";
import { deviceFunctionUrl, type UpstreamFetch } from "./forwarding";
import { createGateway } from "./index";
import { websiteRedirectFor } from "./redirects";

const FUNCTION_URL = "https://wfvqnijwuyqjibhlcrhz.supabase.co/functions/v1/nightly-gateway";
const LEGACY_R2 = "https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev";
const RETIRED_FORWARDED_ORIGIN_HEADER = "x-nightly-forwarded-origin";
const SESSION = Object.freeze({ device_code: "d".repeat(43), user_code: "AB2D-EF3H", expires_in: 600, interval: 3 });

type UpstreamCall = { url: string; init: RequestInit; body: string };

// Env without DB or Hyperdrive: these routes must answer without opening a database connection.
function statelessEnv(functionUrl = FUNCTION_URL): Env {
    return { LEGACY_R2_ORIGIN: LEGACY_R2, NIGHTLY_FUNCTION_URL: functionUrl } as unknown as Env;
}

// A body stream that fails on its first read, standing in for a dropped connection.
function erroringStream(): ReadableStream<Uint8Array> {
    return new ReadableStream({ pull(controller) { controller.error(new Error("connection reset")); } });
}

// Collects the Worker's structured log events in memory, so tests can check what it logged without touching console.
function recordingLog(): { log: (event: Record<string, unknown>) => void; events: Array<Record<string, unknown>> } {
    const events: Array<Record<string, unknown>> = [];
    return { events, log: (event) => { events.push(event); } };
}

// Records each upstream call and answers with the given response factory.
function recordingFetch(respond: () => Response | Promise<Response>): { fetch: UpstreamFetch; calls: UpstreamCall[] } {
    const calls: UpstreamCall[] = [];
    return {
        calls,
        fetch: async (url, init) => {
            const body = init.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : String(init.body ?? "");
            calls.push({ url, init, body });
            return respond();
        },
    };
}

// Builds an installer-style urlencoded POST that also carries a cookie the forwarder must drop.
function formRequest(origin: string, path: string, body: string): Request {
    return new Request(`${origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: "nightly_sponsor=secret" },
        body,
    });
}

test("device session creation is forwarded and the gateway adds its own activation link", async () => {
    const upstream = recordingFetch(() => Response.json(SESSION, { status: 201 }));
    const gateway = createGateway({ fetch: upstream.fetch });

    const response = await gateway.fetch(formRequest(CANONICAL_GATEWAY_ORIGIN, "/v1/device/sessions", "client=installer"), statelessEnv());

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { ...SESSION, verification_uri: `${CANONICAL_GATEWAY_ORIGIN}/activate?code=AB2D-EF3H` });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(upstream.calls.length, 1);
    const [call] = upstream.calls;
    assert.equal(call.url, `${FUNCTION_URL}/v1/device/sessions`);
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.redirect, "manual");
    assert.equal(call.body, "client=installer");
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get(RETIRED_FORWARDED_ORIGIN_HEADER), null);
    assert.equal(headers.get("content-type"), "application/x-www-form-urlencoded");
    assert.equal(headers.get("cookie"), null);
});

test("the activation link follows the allowlisted request host and replaces any upstream link", async () => {
    const cases = [
        { origin: CANONICAL_GATEWAY_ORIGIN, expected: CANONICAL_GATEWAY_ORIGIN },
        { origin: LEGACY_GATEWAY_ORIGIN, expected: LEGACY_GATEWAY_ORIGIN },
        { origin: "https://gateway.attacker.invalid", expected: CANONICAL_GATEWAY_ORIGIN },
    ];
    for (const entry of cases) {
        const stale = { ...SESSION, verification_uri: "https://attacker.invalid/activate?code=AB2D-EF3H" };
        const gateway = createGateway({ fetch: recordingFetch(() => Response.json(stale, { status: 201 })).fetch });
        const response = await gateway.fetch(formRequest(entry.origin, "/v1/device/sessions", "client=installer"), statelessEnv());
        const body = await response.json() as { verification_uri: string };
        assert.equal(body.verification_uri, `${entry.expected}/activate?code=AB2D-EF3H`, entry.origin);
    }
});

test("session responses without a created, valid user code are passed through untouched", async () => {
    const outcomes = [
        { status: 200, body: SESSION },
        { status: 201, body: { ...SESSION, user_code: "not-a-code" } },
        { status: 201, body: [SESSION] },
        { status: 400, body: { error: "invalid_request" } },
    ];
    for (const outcome of outcomes) {
        const gateway = createGateway({ fetch: recordingFetch(() => Response.json(outcome.body, { status: outcome.status })).fetch });
        const response = await gateway.fetch(formRequest(CANONICAL_GATEWAY_ORIGIN, "/v1/device/sessions", "client=installer"), statelessEnv());
        assert.equal(response.status, outcome.status);
        assert.deepEqual(await response.json(), outcome.body);
    }
});

test("device token polling passes every status through without an activation link", async () => {
    const outcomes = [
        { status: 200, body: { access_token: "a".repeat(43), token_type: "Bearer", expires_in: 3600 } },
        { status: 428, body: { error: "authorization_pending" } },
        { status: 403, body: { error: "supporter_role_required" } },
        { status: 409, body: { error: "already_used" } },
        { status: 502, body: { error: "discord_membership_required", upstream_status: 403, upstream_code: 50001 } },
    ];
    for (const outcome of outcomes) {
        const upstream = recordingFetch(() => Response.json(outcome.body, { status: outcome.status }));
        const gateway = createGateway({ fetch: upstream.fetch });
        const response = await gateway.fetch(
            formRequest(LEGACY_GATEWAY_ORIGIN, "/v1/device/token", `device_code=${"d".repeat(43)}`),
            statelessEnv(`${FUNCTION_URL}/`),
        );
        assert.equal(response.status, outcome.status);
        assert.deepEqual(await response.json(), outcome.body);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(upstream.calls[0].url, `${FUNCTION_URL}/v1/device/token`);
        assert.equal(new Headers(upstream.calls[0].init.headers).get(RETIRED_FORWARDED_ORIGIN_HEADER), null);
    }
});

test("an unreachable or broken Edge Function becomes a logged 502 with a named code and cause class", async () => {
    const failures: Array<{ respond: () => Response | Promise<Response>; code: string; cause?: string }> = [
        { respond: () => Promise.reject(new TypeError("fetch failed")), code: "function_unreachable", cause: "TypeError" },
        { respond: () => Promise.reject(new DOMException("timed out", "TimeoutError")), code: "function_unreachable", cause: "TimeoutError" },
        { respond: () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }), code: "function_response_invalid", cause: "SyntaxError" },
        { respond: () => new Response(null, { status: 200 }), code: "function_response_invalid" },
        { respond: () => new Response("x".repeat(64 * 1024), { status: 200 }), code: "function_response_invalid" },
        { respond: () => new Response(null, { status: 302, headers: { location: "https://example.invalid/" } }), code: "function_response_invalid" },
        { respond: () => new Response(erroringStream(), { status: 200 }), code: "function_response_invalid", cause: "Error" },
    ];
    for (const failure of failures) {
        const logger = recordingLog();
        const gateway = createGateway({ fetch: recordingFetch(failure.respond).fetch, log: logger.log });
        const response = await gateway.fetch(
            formRequest(CANONICAL_GATEWAY_ORIGIN, "/v1/device/sessions", "client=installer"),
            statelessEnv(),
        );
        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), { error: failure.code });
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.deepEqual(logger.events, [{
            event: "nightly_gateway_request_failed",
            path: "/v1/device/sessions",
            error: failure.code,
            ...(failure.cause === undefined ? {} : { cause: failure.cause }),
        }], failure.code);
    }
});

test("the logged cause names only the failure class, never its message", async () => {
    const logger = recordingLog();
    const secret = "Bearer sk_live_do_not_log";
    const gateway = createGateway({ fetch: () => Promise.reject(new TypeError(secret)), log: logger.log });
    await gateway.fetch(formRequest(CANONICAL_GATEWAY_ORIGIN, "/v1/device/token", "device_code=x"), statelessEnv());
    assert.equal(logger.events.length, 1);
    assert.equal(logger.events[0].cause, "TypeError");
    assert.doesNotMatch(JSON.stringify(logger.events), /sk_live_do_not_log/);
});

test("a failing installer request stream is an internal error, not an oversized body", async () => {
    const upstream = recordingFetch(() => Response.json({}));
    const logger = recordingLog();
    const gateway = createGateway({ fetch: upstream.fetch, log: logger.log });
    const request = new Request(`${CANONICAL_GATEWAY_ORIGIN}/v1/device/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: erroringStream(),
        duplex: "half",
    } as RequestInit);
    const response = await gateway.fetch(request, statelessEnv());
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "internal_error" });
    assert.equal(upstream.calls.length, 0);
    assert.deepEqual(logger.events, [{ event: "nightly_gateway_request_failed", path: "/v1/device/token", error: "internal_error", cause: "Error" }]);
});

test("oversized device request bodies are refused before anything is forwarded", async () => {
    const upstream = recordingFetch(() => Response.json({}));
    const gateway = createGateway({ fetch: upstream.fetch });
    const response = await gateway.fetch(
        formRequest(CANONICAL_GATEWAY_ORIGIN, "/v1/device/token", `device_code=${"d".repeat(8 * 1024)}`),
        statelessEnv(),
    );
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "request_too_large" });
    assert.equal(upstream.calls.length, 0);
});

test("the Edge Function URL must be a plain https base URL", () => {
    assert.equal(deviceFunctionUrl(FUNCTION_URL, "/v1/device/sessions"), `${FUNCTION_URL}/v1/device/sessions`);
    assert.equal(deviceFunctionUrl(`${FUNCTION_URL}/`, "/v1/device/token"), `${FUNCTION_URL}/v1/device/token`);
    for (const invalid of [undefined, "", "http://example.invalid/fn", `${FUNCTION_URL}?x=1`, "https://user:pass@example.invalid/fn", "not a url"]) {
        assert.throws(() => deviceFunctionUrl(invalid, "/v1/device/sessions"), /gateway_function_url_invalid/);
    }
    assert.throws(() => deviceFunctionUrl(FUNCTION_URL, "/v1/pins"), /gateway_function_url_invalid/);
});

test("a misconfigured Edge Function URL fails closed without calling anything", async () => {
    const upstream = recordingFetch(() => Response.json({}));
    const logger = recordingLog();
    const gateway = createGateway({ fetch: upstream.fetch, log: logger.log });
    const response = await gateway.fetch(formRequest(CANONICAL_GATEWAY_ORIGIN, "/v1/device/sessions", "client=installer"), statelessEnv("http://insecure.invalid"));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "internal_error" });
    assert.equal(upstream.calls.length, 0);
    assert.equal(logger.events.length, 1);
});

test("retired gateway pages redirect to the website on both gateway hosts", async () => {
    const gateway = createGateway({ fetch: () => Promise.reject(new Error("redirects must not call upstream")) });
    const cases = [
        { method: "GET", path: "/", status: 302, location: "https://bannerlordcoop.com/nightly" },
        { method: "GET", path: "/activate?code=AB2D-EF3H", status: 302, location: "https://bannerlordcoop.com/nightly/activate?code=AB2D-EF3H" },
        { method: "GET", path: "/sponsor", status: 301, location: "https://bannerlordcoop.com/nightly/sponsor" },
        { method: "GET", path: "/sponsor/login", status: 301, location: "https://bannerlordcoop.com/nightly/sponsor/login" },
        { method: "GET", path: "/oauth/callback?code=abc&state=xyz", status: 301, location: "https://bannerlordcoop.com/nightly/callback?code=abc&state=xyz" },
        { method: "POST", path: "/v1/sponsorship/claim", status: 301, location: "https://bannerlordcoop.com/nightly/sponsor" },
        { method: "POST", path: "/v1/sponsor/code", status: 301, location: "https://bannerlordcoop.com/nightly/sponsor" },
        { method: "POST", path: "/v1/sponsor/remove", status: 301, location: "https://bannerlordcoop.com/nightly/sponsor" },
    ];
    for (const origin of [CANONICAL_GATEWAY_ORIGIN, LEGACY_GATEWAY_ORIGIN]) {
        for (const entry of cases) {
            const response = await gateway.fetch(new Request(`${origin}${entry.path}`, { method: entry.method, redirect: "manual" }), statelessEnv());
            assert.equal(response.status, entry.status, `${entry.method} ${origin}${entry.path}`);
            assert.equal(response.headers.get("location"), entry.location);
            assert.equal(response.headers.get("cache-control"), "no-store");
        }
    }
});

test("routes the gateway still serves are never redirected", () => {
    for (const path of ["/health", "/install?pin=x", "/install.cmd", "/v1/pins/install.cmd", "/v1/manifests/client", "/v1/device/sessions", "/activate/extra"]) {
        assert.equal(websiteRedirectFor("GET", new URL(`${CANONICAL_GATEWAY_ORIGIN}${path}`)), null, path);
    }
    assert.equal(websiteRedirectFor("POST", new URL(`${CANONICAL_GATEWAY_ORIGIN}/`)), null);
    assert.equal(websiteRedirectFor("POST", new URL(`${CANONICAL_GATEWAY_ORIGIN}/activate?code=AB2D-EF3H`)), null);
});

test("health still answers once the database is reachable", async () => {
    const gateway = createGateway({ fetch: () => Promise.reject(new Error("health must not call upstream")) });
    const env = { ...statelessEnv(), DB: { prepare() { throw new Error("unused"); }, batch() { throw new Error("unused"); } } } as unknown as Env;
    const response = await gateway.fetch(new Request(`${LEGACY_GATEWAY_ORIGIN}/health`), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
});
