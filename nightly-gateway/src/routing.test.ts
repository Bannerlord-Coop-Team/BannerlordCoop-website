import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_GATEWAY_ORIGIN, LEGACY_GATEWAY_ORIGIN } from "./core";
import { FORWARDED_ORIGIN_HEADER, deviceFunctionUrl, type UpstreamFetch } from "./forwarding";
import { createGateway } from "./index";
import { websiteRedirectFor } from "./redirects";

const FUNCTION_URL = "https://wfvqnijwuyqjibhlcrhz.supabase.co/functions/v1/nightly-gateway";
const LEGACY_R2 = "https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev";

type UpstreamCall = { url: string; init: RequestInit; body: string };

// Env without DB or Hyperdrive: these routes must answer without opening a database connection.
function statelessEnv(functionUrl = FUNCTION_URL): Env {
    return { LEGACY_R2_ORIGIN: LEGACY_R2, NIGHTLY_FUNCTION_URL: functionUrl } as unknown as Env;
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

function formRequest(origin: string, path: string, body: string): Request {
    return new Request(`${origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: "nightly_sponsor=secret" },
        body,
    });
}

test("device session creation is forwarded to the Edge Function with the installer's gateway origin", async () => {
    const session = {
        device_code: "d".repeat(43),
        user_code: "AB2D-EF3H",
        verification_uri: `${CANONICAL_GATEWAY_ORIGIN}/activate?code=AB2D-EF3H`,
        expires_in: 600,
        interval: 3,
    };
    const upstream = recordingFetch(() => Response.json(session, { status: 201 }));
    const gateway = createGateway({ fetch: upstream.fetch });

    const response = await gateway.fetch(formRequest(CANONICAL_GATEWAY_ORIGIN, "/v1/device/sessions", "client=installer"), statelessEnv());

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), session);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(upstream.calls.length, 1);
    const [call] = upstream.calls;
    assert.equal(call.url, `${FUNCTION_URL}/v1/device/sessions`);
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.redirect, "manual");
    assert.equal(call.body, "client=installer");
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get(FORWARDED_ORIGIN_HEADER), CANONICAL_GATEWAY_ORIGIN);
    assert.equal(headers.get("content-type"), "application/x-www-form-urlencoded");
    assert.equal(headers.get("cookie"), null);
});

test("device token polling keeps the legacy host as the forwarded origin and passes every status through", async () => {
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
        assert.equal(new Headers(upstream.calls[0].init.headers).get(FORWARDED_ORIGIN_HEADER), LEGACY_GATEWAY_ORIGIN);
    }
});

test("device requests on an unknown host forward the canonical gateway origin", async () => {
    const upstream = recordingFetch(() => Response.json({ error: "invalid_request" }, { status: 400 }));
    const gateway = createGateway({ fetch: upstream.fetch });
    const response = await gateway.fetch(formRequest("https://gateway.attacker.invalid", "/v1/device/sessions", "client=installer"), statelessEnv());
    assert.equal(response.status, 400);
    assert.equal(new Headers(upstream.calls[0].init.headers).get(FORWARDED_ORIGIN_HEADER), CANONICAL_GATEWAY_ORIGIN);
});

test("an unreachable or broken Edge Function becomes 502 internal_error", async () => {
    const failures: Array<() => Response | Promise<Response>> = [
        () => Promise.reject(new TypeError("fetch failed")),
        () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }),
        () => new Response(null, { status: 200 }),
        () => new Response("x".repeat(64 * 1024), { status: 200 }),
        () => new Response(null, { status: 302, headers: { location: "https://example.invalid/" } }),
    ];
    for (const failure of failures) {
        const gateway = createGateway({ fetch: recordingFetch(failure).fetch });
        const response = await gateway.fetch(formRequest(CANONICAL_GATEWAY_ORIGIN, "/v1/device/sessions", "client=installer"), statelessEnv());
        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), { error: "internal_error" });
        assert.equal(response.headers.get("cache-control"), "no-store");
    }
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
    const gateway = createGateway({ fetch: upstream.fetch });
    const response = await gateway.fetch(formRequest(CANONICAL_GATEWAY_ORIGIN, "/v1/device/sessions", "client=installer"), statelessEnv("http://insecure.invalid"));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "internal_error" });
    assert.equal(upstream.calls.length, 0);
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
