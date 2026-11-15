import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import { isBearerToken, sha256 as workerSha256 } from "../../../nightly-gateway/src/primitives.ts";
import { type ConnectionPool, pooledGatewayDatabase } from "../_shared/nightly/database.ts";
import { assertDiscordCredentials } from "../_shared/nightly/discord.ts";
import { createNightlyGatewayHandler } from "../_shared/nightly/gateway.ts";
import { hasNightlyAccessRole, isEligibleNightlySponsor } from "../_shared/nightly/policy.ts";
import { sha256 } from "../_shared/nightly/tokens.ts";
import {
    BOT_TOKEN,
    body,
    clearGatewayTables,
    CLIENT_ID,
    COMPETITION_WINNER_ROLE,
    createGatewayDatabase,
    discordFetch,
    discordScript,
    failingDatabase,
    FRIEND,
    gatewayHandler,
    installerRequest,
    NOW,
    OTHER_SPONSOR,
    PATREON_ROLE,
    rows,
    seedDevice,
    seedDownloadSession,
    seedGrant,
    seedPortalState,
    seedSeat,
    seedSponsorSession,
    singleConnectionDatabase,
    SingleConnectionPool,
    SPONSOR,
    TOKEN_URL,
    WEBSITE_KEY,
    websiteRequest,
} from "./test-harness.ts";

let database: PGlite;

before(async () => { database = await createGatewayDatabase(); });
after(async () => { await database?.close(); });
beforeEach(async () => { await clearGatewayTables(database); });

/** Reads one device session's mutable fields. */
async function device(id: string) {
    const [row] = await rows<{ status: string; discord_user_id: string | null; sponsor_discord_user_id: string | null; authorized_at: number | null }>(
        database,
        "select status, discord_user_id, sponsor_discord_user_id, authorized_at from nightly_gateway.device_sessions where id = $1",
        [id],
    );
    return row;
}

/** Counts rows in a gateway table. */
async function count(table: string, where = "true", values: unknown[] = []): Promise<number> {
    const [row] = await rows<{ count: number }>(database, `select count(*)::int as count from nightly_gateway.${table} where ${where}`, values);
    return row!.count;
}

/** Runs a device sign-in through a handler with `redirectUri` and returns the redirect URIs sent to consent and exchange. */
async function redirectUrisSent(redirectUri?: string): Promise<[string | null, string | null]> {
    const script = discordScript({ member: { roles: [PATREON_ROLE] } });
    const handler = createNightlyGatewayHandler({
        websiteKey: WEBSITE_KEY,
        discord: { clientId: CLIENT_ID, clientSecret: "s".repeat(32), botToken: BOT_TOKEN, redirectUri },
        fetch: discordFetch(script),
        database: singleConnectionDatabase(database),
        clock: () => NOW * 1000,
    });
    const pending = await seedDevice(database);
    const start = await handler(websiteRequest("/oauth/start", { purpose: "device", user_code: pending.userCode }));
    const authorizeUrl = new URL((await body(start)).authorize_url as string);
    const complete = await handler(websiteRequest("/oauth/complete", { code: "discord-code", state: authorizeUrl.searchParams.get("state") }));
    assert.equal(complete.status, 200);
    const exchange = script.calls.find((call) => call.url === TOKEN_URL)!;
    return [authorizeUrl.searchParams.get("redirect_uri"), new URLSearchParams(exchange.body).get("redirect_uri")];
}

// ---- Access policy ----

test("supporters, Testers, Staff, and Competition Winners get nightly access and share the same seat limit", () => {
    for (const role of [
        "1532151760012050452", "1532744756151455834", "1533090199104524338", "710222948375593010",
        "730945590011232296", "711610715152056331", "750401609045115114", "709516608741048390",
        "730631536122003548", "730631233524072588", "1551834978570997792",
    ]) assert.equal(hasNightlyAccessRole([role]), true, role);
    assert.equal(hasNightlyAccessRole(["709516043332354119"]), false);
    assert.equal(isEligibleNightlySponsor({ roles: [PATREON_ROLE] }), true);
    assert.equal(isEligibleNightlySponsor({ roles: [COMPETITION_WINNER_ROLE] }), true);
    assert.equal(isEligibleNightlySponsor({ roles: [] }), false);
    assert.equal(isEligibleNightlySponsor({ roles: "not-an-array" }), false);
    assert.equal(isEligibleNightlySponsor(null), false);
});

test("the handler refuses implausible secrets at construction", () => {
    const base = {
        websiteKey: WEBSITE_KEY,
        discord: { clientId: CLIENT_ID, clientSecret: "s".repeat(32), botToken: BOT_TOKEN },
        fetch,
        database: failingDatabase(() => new Error("unused")),
    };
    assert.doesNotThrow(() => createNightlyGatewayHandler(base));
    assert.throws(() => createNightlyGatewayHandler({ ...base, websiteKey: "short" }), /nightly_gateway_configuration_invalid/);
    assert.throws(() => createNightlyGatewayHandler({ ...base, discord: { ...base.discord, clientId: "app" } }), /configuration_invalid/);
    assert.throws(() => createNightlyGatewayHandler({ ...base, discord: { ...base.discord, botToken: "x" } }), /configuration_invalid/);
    assert.throws(
        () => createNightlyGatewayHandler({ ...base, discord: { ...base.discord, clientSecret: "s".repeat(31) } }),
        /configuration_invalid: discord\.clientSecret/,
    );
    assert.throws(() => createNightlyGatewayHandler({ ...base, websiteKey: "w".repeat(31) }), (error: Error) =>
        /configuration_invalid: websiteKey$/.test(error.message) && !error.message.includes("w".repeat(31)));
});

test("Discord credentials accept an https or loopback-http redirect URI and refuse anything else", () => {
    const credentials = { clientId: CLIENT_ID, clientSecret: "s".repeat(32), botToken: BOT_TOKEN };
    const withRedirect = (redirectUri: string) => assertDiscordCredentials({ ...credentials, redirectUri });
    assert.doesNotThrow(() => assertDiscordCredentials(credentials), "the redirect URI is optional");
    for (const valid of [
        "https://preview.bannerlordcoop.com/nightly/callback",
        "http://localhost:3000/nightly/callback",
        "http://127.0.0.1:3000/nightly/callback",
    ]) assert.doesNotThrow(() => withRedirect(valid), valid);
    for (const invalid of [
        "",
        "/nightly/callback",
        "http://bannerlordcoop.com/nightly/callback",
        "http://localhost.evil.example/nightly/callback",
        "ftp://localhost/nightly/callback",
        "https://user:secret-pass@bannerlordcoop.com/nightly/callback",
        "https://bannerlordcoop.com/nightly/callback#fragment",
        "https://bannerlordcoop.com/nightly/callback ",
    ]) {
        assert.throws(() => withRedirect(invalid), (error: Error) =>
            /configuration_invalid: discord\.redirectUri$/.test(error.message) && !error.message.includes("secret-pass"), invalid);
    }
});

test("the Discord redirect URI defaults to the production callback for both consent and token exchange", async () => {
    assert.deepEqual(await redirectUrisSent(), ["https://bannerlordcoop.com/nightly/callback", "https://bannerlordcoop.com/nightly/callback"]);
});

test("a configured loopback redirect URI reaches both the consent URL and the token exchange", async () => {
    const local = "http://localhost:3000/nightly/callback";
    assert.deepEqual(await redirectUrisSent(local), [local, local]);
});

// ---- Routing and website key ----

test("device sessions are 10-minute pending sessions; the Worker adds verification_uri", async () => {
    const script = discordScript();
    const { handler } = gatewayHandler(database, script);
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await handler(installerRequest("/v1/device/sessions", "client=installer"));
        assert.equal(response.status, 201);
        assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
        assert.equal(response.headers.get("cache-control"), "no-store");
        const text = await response.text();
        assert.ok(text.endsWith("}\n"));
        const session = JSON.parse(text) as Record<string, unknown>;
        assert.deepEqual(Object.keys(session), ["device_code", "user_code", "expires_in", "interval"]);
        assert.match(session.device_code as string, /^[A-Za-z0-9_-]{43}$/);
        assert.match(session.user_code as string, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
        assert.equal(session.expires_in, 600);
        assert.equal(session.interval, 3);
        const [row] = await rows<{ status: string; created_at: number; expires_at: number }>(
            database,
            "select status, created_at, expires_at from nightly_gateway.device_sessions where device_secret_hash = $1",
            [await sha256(session.device_code as string)],
        );
        assert.deepEqual(row, { status: "pending", created_at: NOW, expires_at: NOW + 600 });
    }
    assert.equal(script.calls.length, 0);
});

test("website routes require the shared website key", async () => {
    const script = discordScript();
    const { handler } = gatewayHandler(database, script);
    for (const key of [null, "", "w".repeat(47), "x".repeat(48), `${WEBSITE_KEY}x`]) {
        for (const path of ["/oauth/start", "/oauth/complete", "/sponsorship/claim", "/sponsor/portal", "/sponsor/code", "/sponsor/remove"]) {
            const response = await handler(websiteRequest(path, { purpose: "sponsor-portal" }, key));
            assert.equal(response.status, 401, `${path} ${key}`);
            assert.deepEqual(await body(response), { error: "unauthorized" });
        }
    }
    assert.equal(script.calls.length, 0);
    const allowed = await handler(websiteRequest("/oauth/start", { purpose: "sponsor-portal" }));
    assert.equal(allowed.status, 200);
});

test("unknown paths, other methods, and malformed or oversized bodies are rejected", async () => {
    const { handler } = gatewayHandler(database, discordScript());
    assert.equal((await handler(websiteRequest("/v1/sponsor/code", {}))).status, 404);
    assert.equal((await handler(websiteRequest("/../oauth/start", {}))).status, 404);
    assert.equal((await handler(new Request("http://localhost/other-function/oauth/start", { method: "POST" }))).status, 404);
    const get = await handler(new Request(`http://localhost/nightly-gateway/oauth/start`, { headers: { "x-nightly-website-key": WEBSITE_KEY } }));
    assert.equal(get.status, 404);
    assert.deepEqual(await body(get), { error: "not_found" });
    const notJson = await handler(new Request("http://localhost/nightly-gateway/oauth/start", {
        method: "POST", headers: { "x-nightly-website-key": WEBSITE_KEY }, body: "purpose=device",
    }));
    assert.deepEqual([notJson.status, await body(notJson)], [400, { error: "invalid_request" }]);
    const array = await handler(websiteRequest("/oauth/start", ["sponsor-portal"]));
    assert.deepEqual([array.status, await body(array)], [400, { error: "invalid_request" }]);
    const huge = await handler(websiteRequest("/oauth/start", { purpose: "x".repeat(5000) }));
    assert.deepEqual([huge.status, await body(huge)], [413, { error: "request_too_large" }]);
    const hugeForm = await handler(installerRequest("/v1/device/token", `device_code=${"x".repeat(5000)}`));
    assert.deepEqual([hugeForm.status, await body(hugeForm)], [413, { error: "request_too_large" }]);
});

// ---- Device token issue ----

test("polling reports invalid, expired, and pending device sessions with the installer's codes", async () => {
    const { handler } = gatewayHandler(database, discordScript());
    const poll = async (code: string) => {
        const response = await handler(installerRequest("/v1/device/token", `device_code=${code}`));
        return [response.status, (await body(response)).error];
    };
    assert.deepEqual(await poll("short"), [400, "invalid_request"]);
    assert.deepEqual(await poll("Z".repeat(43)), [400, "expired_token"]);
    const expired = await seedDevice(database, { suffix: "E", expiresAt: NOW - 1 });
    assert.deepEqual(await poll(expired.secret), [400, "expired_token"]);
    const pending = await seedDevice(database, { suffix: "P" });
    assert.deepEqual(await poll(pending.secret), [428, "authorization_pending"]);
    const awaiting = await seedDevice(database, { suffix: "W", status: "awaiting-sponsor", discordUserId: FRIEND });
    assert.deepEqual(await poll(awaiting.secret), [428, "authorization_pending"]);
    const denied = await seedDevice(database, { suffix: "D", status: "denied" });
    assert.deepEqual(await poll(denied.secret), [403, "access_denied"]);
});

test("an approved session trades for one 1-hour download token after re-checking the sponsor", async () => {
    await seedGrant(database, SPONSOR);
    const script = discordScript({ bot: { [SPONSOR]: { roles: [PATREON_ROLE] } } });
    const { handler } = gatewayHandler(database, script);
    const approved = await seedDevice(database, { status: "approved", discordUserId: FRIEND, sponsorId: SPONSOR });
    const response = await handler(installerRequest("/v1/device/token", `device_code=${approved.secret}`));
    assert.equal(response.status, 200);
    const token = await body(response);
    assert.deepEqual(Object.keys(token), ["access_token", "token_type", "expires_in"]);
    assert.ok(isBearerToken(token.access_token), "the Worker accepts the token's shape");
    assert.equal(token.token_type, "Bearer");
    assert.equal(token.expires_in, 3600);
    const [session] = await rows(database, "select device_session_id, discord_user_id, supporter_discord_user_id, created_at, expires_at from nightly_gateway.download_sessions where token_hash = $1", [await workerSha256(token.access_token as string)]);
    assert.deepEqual(session, {
        device_session_id: approved.id, discord_user_id: FRIEND, supporter_discord_user_id: SPONSOR,
        created_at: NOW, expires_at: NOW + 3600,
    });
    assert.equal((await device(approved.id))!.status, "consumed");
    const botCall = script.calls.find((call) => call.url.endsWith(`/members/${SPONSOR}`))!;
    assert.equal(botCall.headers.get("authorization"), `Bot ${BOT_TOKEN}`);
    assert.equal(botCall.headers.get("user-agent"), "DiscordBot (https://bannerlordcoop.com, 1)");

    const replay = await handler(installerRequest("/v1/device/token", `device_code=${approved.secret}`));
    assert.deepEqual([replay.status, await body(replay)], [403, { error: "access_denied" }]);
});

test("a poll that loses the issue race to an existing download session is 409 already_used and changes nothing", async () => {
    await seedGrant(database, SPONSOR);
    const { handler } = gatewayHandler(database, discordScript({ bot: { [SPONSOR]: { roles: [PATREON_ROLE] } } }));
    const approved = await seedDevice(database, { status: "approved", discordUserId: FRIEND, sponsorId: SPONSOR });
    await seedDownloadSession(database, FRIEND, SPONSOR, "r".repeat(43), approved.id);
    const response = await handler(installerRequest("/v1/device/token", `device_code=${approved.secret}`));
    assert.deepEqual([response.status, await body(response)], [409, { error: "already_used" }]);
    assert.equal((await device(approved.id))!.status, "approved", "the consuming update rolls back with the failed insert");
    assert.equal(await count("download_sessions", "device_session_id = $1", [approved.id]), 1);
    assert.equal(await count("download_sessions"), 1);
});

test("a poll that loses the consuming update to a concurrent poll is 409 already_used and issues nothing", async () => {
    await seedGrant(database, SPONSOR);
    const approved = await seedDevice(database, { status: "approved", discordUserId: FRIEND, sponsorId: SPONSOR });
    const script = discordScript({ bot: { [SPONSOR]: { roles: [PATREON_ROLE] } } });
    script.beforeBotLookup = async () => {
        // The concurrent poll consumes the session while this one re-checks the sponsor.
        await database.query("update nightly_gateway.device_sessions set status = 'consumed' where id = $1", [approved.id]);
    };
    const { handler } = gatewayHandler(database, script);
    const response = await handler(installerRequest("/v1/device/token", `device_code=${approved.secret}`));
    assert.deepEqual([response.status, await body(response)], [409, { error: "already_used" }]);
    assert.equal((await device(approved.id))!.status, "consumed");
    assert.equal(await count("download_sessions", "device_session_id = $1", [approved.id]), 0);
});

test("a sponsor who lost the role at token issue loses grants and download sessions", async () => {
    await seedGrant(database, SPONSOR);
    await seedSeat(database, SPONSOR, FRIEND);
    await seedDownloadSession(database, FRIEND, SPONSOR);
    const { handler } = gatewayHandler(database, discordScript({ bot: { [SPONSOR]: { roles: [] } } }));
    const approved = await seedDevice(database, { status: "approved", discordUserId: FRIEND, sponsorId: SPONSOR });
    const response = await handler(installerRequest("/v1/device/token", `device_code=${approved.secret}`));
    assert.deepEqual([response.status, await body(response)], [403, { error: "supporter_role_required" }]);
    assert.equal(await count("supporter_grants"), 0);
    assert.equal(await count("sponsorships"), 0);
    assert.equal(await count("download_sessions"), 0);
});

test("Discord failures propagate upstream_status and upstream_code", async () => {
    await seedGrant(database, SPONSOR);
    const script = discordScript({
        botFailure: () => Response.json({ message: "Missing Access", code: 50001 }, { status: 403 }),
    });
    const { handler, logs } = gatewayHandler(database, script);
    const approved = await seedDevice(database, { status: "approved", discordUserId: FRIEND, sponsorId: SPONSOR });
    const response = await handler(installerRequest("/v1/device/token", `device_code=${approved.secret}`));
    assert.equal(response.status, 502);
    assert.deepEqual(await body(response), { error: "discord_membership_required", upstream_status: 403, upstream_code: 50001 });
    assert.equal((await device(approved.id))!.status, "approved", "a Discord outage never consumes the session");
    assert.equal(await count("supporter_grants"), 1, "a Discord outage never revokes the sponsor");
    assert.deepEqual(logs.at(-1), {
        event: "nightly_gateway_request_failed", path: "/functions/v1/nightly-gateway/v1/device/token",
        error: "discord_membership_required", upstream_status: 403, upstream_code: 50001,
    });

    script.botFailure = () => new Response("<html>bad gateway</html>", { status: 502 });
    const htmlFailure = await handler(installerRequest("/v1/device/token", `device_code=${approved.secret}`));
    assert.deepEqual(await body(htmlFailure), { error: "discord_membership_required", upstream_status: 502 });

    const state = await seedPortalState(database);
    script.tokenFailure = () => Response.json({ error: "invalid_grant" }, { status: 400 });
    const exchange = await handler(websiteRequest("/oauth/complete", { code: "used-code", state }));
    assert.deepEqual([exchange.status, await body(exchange)], [502, { error: "discord_authorization_failed", upstream_status: 400 }]);
});

// ---- OAuth start ----

test("device OAuth start binds a state to a live installer code and returns Discord's consent URL", async () => {
    const { handler } = gatewayHandler(database, discordScript());
    const pending = await seedDevice(database, { suffix: "B" });
    const response = await handler(websiteRequest("/oauth/start", { purpose: "device", user_code: pending.userCode.toLowerCase() }));
    assert.equal(response.status, 200);
    const url = new URL((await body(response)).authorize_url as string);
    assert.equal(`${url.origin}${url.pathname}`, "https://discord.com/oauth2/authorize");
    assert.equal(url.searchParams.get("client_id"), CLIENT_ID);
    assert.equal(url.searchParams.get("redirect_uri"), "https://bannerlordcoop.com/nightly/callback");
    assert.equal(url.searchParams.get("scope"), "identify guilds.members.read");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("prompt"), "consent");
    const state = url.searchParams.get("state")!;
    assert.match(state, /^[A-Za-z0-9_-]{43}$/);
    const [row] = await rows<{ oauth_state_hash: string }>(database, "select oauth_state_hash from nightly_gateway.device_sessions where id = $1", [pending.id]);
    assert.equal(row!.oauth_state_hash, await sha256(state));
});

test("device OAuth start rejects malformed, unknown, expired, and finished installer codes", async () => {
    const { handler } = gatewayHandler(database, discordScript());
    const start = async (userCode: unknown) => {
        const response = await handler(websiteRequest("/oauth/start", { purpose: "device", user_code: userCode }));
        return [response.status, (await body(response)).error];
    };
    assert.deepEqual(await start("ABCD"), [400, "invalid_code"]);
    assert.deepEqual(await start(undefined), [400, "invalid_code"]);
    assert.deepEqual(await start("ABCD-WXYZ"), [400, "expired"]);
    const expired = await seedDevice(database, { suffix: "E", expiresAt: NOW - 1 });
    assert.deepEqual(await start(expired.userCode), [400, "expired"]);
    const consumed = await seedDevice(database, { suffix: "C", status: "consumed" });
    assert.deepEqual(await start(consumed.userCode), [400, "expired"]);
    const response = await handler(websiteRequest("/oauth/start", { purpose: "admin" }));
    assert.deepEqual([response.status, await body(response)], [400, { error: "invalid_request" }]);
});

test("sponsor-portal OAuth start stores a 10-minute state", async () => {
    const { handler } = gatewayHandler(database, discordScript());
    const response = await handler(websiteRequest("/oauth/start", { purpose: "sponsor-portal" }));
    const state = new URL((await body(response)).authorize_url as string).searchParams.get("state")!;
    const [row] = await rows(database, "select purpose, created_at, expires_at from nightly_gateway.oauth_states where state_hash = $1", [await sha256(state)]);
    assert.deepEqual(row, { purpose: "sponsor-portal", created_at: NOW, expires_at: NOW + 600 });
});

// ---- OAuth complete outcomes ----

test("OAuth complete rejects malformed bodies and unknown or expired states without calling Discord", async () => {
    const script = discordScript();
    const { handler } = gatewayHandler(database, script);
    const complete = async (input: unknown) => {
        const response = await handler(websiteRequest("/oauth/complete", input));
        return [response.status, (await body(response)).error];
    };
    assert.deepEqual(await complete({ state: "A".repeat(43) }), [400, "invalid_request"]);
    assert.deepEqual(await complete({ code: "", state: "A".repeat(43) }), [400, "invalid_request"]);
    assert.deepEqual(await complete({ code: "x".repeat(513), state: "A".repeat(43) }), [400, "invalid_request"]);
    assert.deepEqual(await complete({ code: "code", state: "short" }), [400, "invalid_request"]);
    assert.deepEqual(await complete({ code: "code", state: "A".repeat(43) }), [400, "expired"]);
    const expiredState = await seedPortalState(database, "e".repeat(43), NOW - 1);
    assert.deepEqual(await complete({ code: "code", state: expiredState }), [400, "expired"]);
    const expired = await seedDevice(database, { suffix: "E", expiresAt: NOW - 1 });
    assert.deepEqual(await complete({ code: "code", state: expired.state }), [400, "expired"]);
    const consumed = await seedDevice(database, { suffix: "C", status: "consumed" });
    assert.deepEqual(await complete({ code: "code", state: consumed.state }), [400, "expired"]);
    assert.equal(script.calls.length, 0);
});

test("a direct member is approved as their own sponsor without storing a refresh token", async () => {
    const script = discordScript({ member: { roles: [PATREON_ROLE] } });
    const { handler } = gatewayHandler(database, script);
    const pending = await seedDevice(database);
    const response = await handler(websiteRequest("/oauth/complete", { code: "discord-code", state: pending.state }));
    assert.deepEqual([response.status, await body(response)], [200, { outcome: "approved" }]);
    assert.deepEqual(await device(pending.id), { status: "approved", discord_user_id: FRIEND, sponsor_discord_user_id: FRIEND, authorized_at: NOW });
    assert.deepEqual(await rows(database, "select encrypted_refresh_token, token_nonce, updated_at from nightly_gateway.supporter_grants where supporter_discord_user_id = $1", [FRIEND]), [
        { encrypted_refresh_token: null, token_nonce: null, updated_at: NOW },
    ]);
    const exchange = script.calls.find((call) => call.url === TOKEN_URL)!;
    const form = new URLSearchParams(exchange.body);
    assert.equal(form.get("redirect_uri"), "https://bannerlordcoop.com/nightly/callback");
    assert.equal(form.get("grant_type"), "authorization_code");
    assert.equal(form.get("code"), "discord-code");
    assert.equal(form.get("client_id"), CLIENT_ID);
    for (const call of script.calls) {
        assert.equal(call.headers.get("user-agent"), "DiscordBot (https://bannerlordcoop.com, 1)");
        assert.ok(call.signal instanceof AbortSignal, `${call.url} has a timeout`);
    }
    assert.equal(script.calls.find((call) => call.url.endsWith("/users/@me"))!.headers.get("authorization"), "Bearer user-access-token");
});

test("Competition Winners are approved directly and can sign in to the sponsor portal", async () => {
    const { handler } = gatewayHandler(database, discordScript({ member: { roles: [COMPETITION_WINNER_ROLE] } }));
    const pending = await seedDevice(database);
    const install = await handler(websiteRequest("/oauth/complete", { code: "code", state: pending.state }));
    assert.deepEqual(await body(install), { outcome: "approved" });
    const portal = await handler(websiteRequest("/oauth/complete", { code: "code", state: await seedPortalState(database) }));
    assert.equal((await body(portal)).outcome, "portal");
});

test("an existing seat with a still-eligible sponsor is sponsored-approved", async () => {
    await seedGrant(database, SPONSOR);
    await seedSeat(database, SPONSOR, FRIEND);
    const { handler } = gatewayHandler(database, discordScript({ bot: { [SPONSOR]: { roles: [PATREON_ROLE] } } }));
    const pending = await seedDevice(database);
    const response = await handler(websiteRequest("/oauth/complete", { code: "code", state: pending.state }));
    assert.deepEqual(await body(response), { outcome: "sponsored-approved" });
    assert.deepEqual(await device(pending.id), { status: "approved", discord_user_id: FRIEND, sponsor_discord_user_id: SPONSOR, authorized_at: NOW });
    assert.equal(await count("supporter_grants"), 1);
});

test("Discord server membership is optional for a friend who needs a sponsor code", async () => {
    const { handler } = gatewayHandler(database, discordScript());
    const pending = await seedDevice(database);
    const response = await handler(websiteRequest("/oauth/complete", { code: "code", state: pending.state }));
    assert.deepEqual(await body(response), {
        outcome: "needs-sponsor", device_id: pending.id, username: "Sponsored Friend", previous_sponsor_revoked: false,
    });
    assert.deepEqual(await device(pending.id), { status: "awaiting-sponsor", discord_user_id: FRIEND, sponsor_discord_user_id: null, authorized_at: null });
    assert.equal(await count("supporter_grants"), 0);
});

test("a guild member without a qualifying role also needs a sponsor code", async () => {
    const { handler } = gatewayHandler(database, discordScript({ member: { roles: [] } }));
    const pending = await seedDevice(database);
    const response = await handler(websiteRequest("/oauth/complete", { code: "code", state: pending.state }));
    assert.equal((await body(response)).outcome, "needs-sponsor");
});

test("losing a sponsor role revokes the seat and reports previous_sponsor_revoked", async () => {
    await seedGrant(database, SPONSOR);
    await seedSeat(database, SPONSOR, FRIEND);
    await seedDownloadSession(database, FRIEND, SPONSOR);
    const { handler } = gatewayHandler(database, discordScript({ bot: { [SPONSOR]: { roles: [] } } }));
    const pending = await seedDevice(database);
    const response = await handler(websiteRequest("/oauth/complete", { code: "code", state: pending.state }));
    assert.deepEqual(await body(response), {
        outcome: "needs-sponsor", device_id: pending.id, username: "Sponsored Friend", previous_sponsor_revoked: true,
    });
    assert.equal(await count("supporter_grants"), 0);
    assert.equal(await count("sponsorships"), 0);
    assert.equal(await count("download_sessions"), 0);
    assert.equal((await device(pending.id))!.status, "awaiting-sponsor");
});

test("a sponsor who left the guild entirely is treated as revoked", async () => {
    await seedGrant(database, SPONSOR);
    await seedSeat(database, SPONSOR, FRIEND);
    const { handler } = gatewayHandler(database, discordScript());
    const pending = await seedDevice(database);
    const response = await handler(websiteRequest("/oauth/complete", { code: "code", state: pending.state }));
    assert.equal((await body(response)).previous_sponsor_revoked, true);
    assert.equal(await count("supporter_grants"), 0);
});

test("a portal login returns a one-use 24-hour sponsor session", async () => {
    const { handler } = gatewayHandler(database, discordScript({ user: { id: SPONSOR, username: "Sponsor" }, member: { roles: [PATREON_ROLE] } }));
    const state = await seedPortalState(database);
    const response = await handler(websiteRequest("/oauth/complete", { code: "code", state }));
    const result = await body(response);
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(result), ["outcome", "session", "expires_in"]);
    assert.equal(result.outcome, "portal");
    assert.equal(result.expires_in, 86400);
    assert.match(result.session as string, /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(await rows(database, "select supporter_discord_user_id, created_at, expires_at from nightly_gateway.sponsor_sessions where token_hash = $1", [await sha256(result.session as string)]), [
        { supporter_discord_user_id: SPONSOR, created_at: NOW, expires_at: NOW + 86400 },
    ]);
    assert.equal(await count("supporter_grants", "supporter_discord_user_id = $1 and encrypted_refresh_token is null", [SPONSOR]), 1);
    assert.equal(await count("oauth_states"), 0);
    const replay = await handler(websiteRequest("/oauth/complete", { code: "code", state }));
    assert.deepEqual([replay.status, await body(replay)], [400, { error: "expired" }]);
});

test("a portal login requires guild membership and a qualifying role", async () => {
    const notMember = gatewayHandler(database, discordScript({ user: { id: SPONSOR, username: "Sponsor" } }));
    const outside = await notMember.handler(websiteRequest("/oauth/complete", { code: "code", state: await seedPortalState(database, "a".repeat(43)) }));
    assert.deepEqual([outside.status, await body(outside)], [403, { error: "discord_membership_required", upstream_status: 404, upstream_code: 10007 }]);
    const roleless = gatewayHandler(database, discordScript({ user: { id: SPONSOR, username: "Sponsor" }, member: { roles: [] } }));
    const noRole = await roleless.handler(websiteRequest("/oauth/complete", { code: "code", state: await seedPortalState(database, "b".repeat(43)) }));
    assert.deepEqual([noRole.status, await body(noRole)], [403, { error: "supporter_role_required" }]);
    assert.equal(await count("sponsor_sessions"), 0);
    assert.equal(await count("supporter_grants"), 0);
});

test("invalid Discord payloads are discord_response_invalid", async () => {
    const pending = await seedDevice(database);
    const badUser = gatewayHandler(database, discordScript({ user: { id: "not-a-snowflake", username: "x" } }));
    const user = await badUser.handler(websiteRequest("/oauth/complete", { code: "code", state: pending.state }));
    assert.deepEqual([user.status, await body(user)], [502, { error: "discord_response_invalid" }]);
    const narrowScope = discordScript();
    narrowScope.tokenFailure = () => Response.json({ access_token: "a", token_type: "Bearer", scope: "identify" });
    const scope = await gatewayHandler(database, narrowScope).handler(websiteRequest("/oauth/complete", { code: "code", state: pending.state }));
    assert.deepEqual([scope.status, await body(scope)], [502, { error: "discord_response_invalid" }]);
});

test("a Discord call that outlives its 8-second timeout is a logged 500 and leaves the session untouched", async (t) => {
    const deadline = new AbortController();
    const timeouts: number[] = [];
    t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
        timeouts.push(milliseconds);
        return deadline.signal;
    });
    const pending = await seedDevice(database);
    const script = discordScript({ stall: true });
    script.beforeEachCall = () => {
        setTimeout(() => deadline.abort(new DOMException("The operation timed out.", "TimeoutError")), 0);
    };
    const { handler, logs } = gatewayHandler(database, script);
    const response = await handler(websiteRequest("/oauth/complete", { code: "code", state: pending.state }));
    assert.deepEqual([response.status, await body(response)], [500, { error: "internal_error" }]);
    assert.deepEqual(timeouts, [8_000]);
    assert.deepEqual(logs.at(-1), {
        event: "nightly_gateway_request_failed", path: "/nightly-gateway/oauth/complete", error: "internal_error", cause: "TimeoutError",
    });
    assert.deepEqual(await device(pending.id), { status: "pending", discord_user_id: null, sponsor_discord_user_id: null, authorized_at: null });
});

test("Discord bodies: oversized is discord_response_too_large, undecodable is discord_response_invalid, a dropped stream is a 500", async () => {
    const pending = await seedDevice(database);
    const complete = async (tokenResponse: () => Response) => {
        const script = discordScript();
        script.tokenFailure = tokenResponse;
        const { handler, logs } = gatewayHandler(database, script);
        const response = await handler(websiteRequest("/oauth/complete", { code: "code", state: pending.state }));
        return { status: response.status, body: await body(response), logs };
    };
    const oversized = await complete(() => new Response("x".repeat(16 * 1024 + 1)));
    assert.deepEqual([oversized.status, oversized.body], [502, { error: "discord_response_too_large" }]);
    const undecodable = await complete(() => new Response(new Uint8Array([0x7b, 0xff, 0x7d])));
    assert.deepEqual([undecodable.status, undecodable.body], [502, { error: "discord_response_invalid" }]);
    const dropped = await complete(() => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new TextEncoder().encode("{"));
            controller.error(new TypeError("network connection lost"));
        },
    })));
    assert.deepEqual([dropped.status, dropped.body], [500, { error: "internal_error" }]);
    assert.equal(dropped.logs.at(-1)!.cause, "TypeError");
});

// ---- Sponsorship claim ----

/** Seeds an awaiting device and an eligible sponsor with code `SPON-SORC-ODE2`, returning the handler. */
async function claimSetup(bot: Record<string, { roles: string[] }> = { [SPONSOR]: { roles: [PATREON_ROLE] } }) {
    await seedGrant(database, SPONSOR, "SPON-SORC-ODE2");
    const awaiting = await seedDevice(database, { status: "awaiting-sponsor", discordUserId: FRIEND });
    return { awaiting, ...gatewayHandler(database, discordScript({ bot })) };
}

test("a sponsor code claims a seat and approves the device", async () => {
    const { handler, awaiting } = await claimSetup();
    const response = await handler(websiteRequest("/sponsorship/claim", { device_id: awaiting.id, sponsor_code: "  spon-sorc-ode2 " }));
    assert.deepEqual([response.status, await body(response)], [200, { outcome: "sponsored-approved" }]);
    assert.deepEqual(await device(awaiting.id), { status: "approved", discord_user_id: FRIEND, sponsor_discord_user_id: SPONSOR, authorized_at: NOW });
    assert.deepEqual(await rows(database, "select supporter_discord_user_id, sponsored_discord_user_id, created_at from nightly_gateway.sponsorships"), [
        { supporter_discord_user_id: SPONSOR, sponsored_discord_user_id: FRIEND, created_at: NOW },
    ]);
});

test("claims reject malformed requests and devices that are not awaiting a sponsor", async () => {
    const { handler } = await claimSetup();
    const claim = async (input: unknown) => {
        const response = await handler(websiteRequest("/sponsorship/claim", input));
        return [response.status, (await body(response)).error];
    };
    assert.deepEqual(await claim({ device_id: "not-a-uuid", sponsor_code: "SPON-SORC-ODE2" }), [400, "invalid_request"]);
    assert.deepEqual(await claim({ device_id: "00000000-0000-4000-8000-000000000041" }), [400, "invalid_request"]);
    assert.deepEqual(await claim({ device_id: "00000000-0000-4000-8000-000000000041", sponsor_code: "x".repeat(129) }), [400, "invalid_request"]);
    assert.deepEqual(await claim({ device_id: "00000000-0000-4000-8000-0000000000ff", sponsor_code: "SPON-SORC-ODE2" }), [400, "expired"]);
    const pending = await seedDevice(database, { suffix: "P" });
    assert.deepEqual(await claim({ device_id: pending.id, sponsor_code: "SPON-SORC-ODE2" }), [400, "expired"]);
    const expired = await seedDevice(database, { suffix: "E", status: "awaiting-sponsor", discordUserId: FRIEND, expiresAt: NOW - 1 });
    assert.deepEqual(await claim({ device_id: expired.id, sponsor_code: "SPON-SORC-ODE2" }), [400, "expired"]);
});

test("claims reject unknown codes and sponsors who lost their role", async () => {
    const { handler, awaiting } = await claimSetup({ [SPONSOR]: { roles: [] } });
    const unknown = await handler(websiteRequest("/sponsorship/claim", { device_id: awaiting.id, sponsor_code: "NOPE-NOPE-NOPE" }));
    assert.deepEqual([unknown.status, await body(unknown)], [403, { error: "invalid_sponsor_code" }]);
    const ineligible = await handler(websiteRequest("/sponsorship/claim", { device_id: awaiting.id, sponsor_code: "SPON-SORC-ODE2" }));
    assert.deepEqual([ineligible.status, await body(ineligible)], [403, { error: "supporter_role_required" }]);
    assert.equal(await count("supporter_grants"), 0);
    assert.equal((await device(awaiting.id))!.status, "awaiting-sponsor");
});

test("a friend already sponsored by another eligible sponsor cannot switch", async () => {
    await seedGrant(database, OTHER_SPONSOR);
    await seedSeat(database, OTHER_SPONSOR, FRIEND);
    const { handler, awaiting } = await claimSetup({ [SPONSOR]: { roles: [PATREON_ROLE] }, [OTHER_SPONSOR]: { roles: [PATREON_ROLE] } });
    const response = await handler(websiteRequest("/sponsorship/claim", { device_id: awaiting.id, sponsor_code: "SPON-SORC-ODE2" }));
    assert.deepEqual([response.status, await body(response)], [409, { error: "already_sponsored" }]);
    assert.equal(await count("sponsorships", "supporter_discord_user_id = $1", [OTHER_SPONSOR]), 1);
});

test("a seat held by a revoked sponsor is replaced by the new sponsor", async () => {
    await seedGrant(database, OTHER_SPONSOR);
    await seedSeat(database, OTHER_SPONSOR, FRIEND);
    await seedDownloadSession(database, FRIEND, OTHER_SPONSOR);
    const { handler, awaiting } = await claimSetup({ [SPONSOR]: { roles: [PATREON_ROLE] }, [OTHER_SPONSOR]: { roles: [] } });
    const response = await handler(websiteRequest("/sponsorship/claim", { device_id: awaiting.id, sponsor_code: "SPON-SORC-ODE2" }));
    assert.deepEqual(await body(response), { outcome: "sponsored-approved" });
    assert.deepEqual(await rows(database, "select supporter_discord_user_id from nightly_gateway.sponsorships where sponsored_discord_user_id = $1", [FRIEND]), [
        { supporter_discord_user_id: SPONSOR },
    ]);
    assert.equal(await count("download_sessions"), 0);
});

test("a sponsor's eleventh claim is seats_full", async () => {
    const { handler, awaiting } = await claimSetup();
    for (let seat = 0; seat < 10; seat += 1) await seedSeat(database, SPONSOR, `11111111111111111${seat}`);
    const response = await handler(websiteRequest("/sponsorship/claim", { device_id: awaiting.id, sponsor_code: "SPON-SORC-ODE2" }));
    assert.deepEqual([response.status, await body(response)], [409, { error: "seats_full" }]);
    assert.equal(await count("sponsorships"), 10);
    assert.equal((await device(awaiting.id))!.status, "awaiting-sponsor");
});

test("re-claiming the same sponsor's seat is idempotent", async () => {
    const { handler, awaiting } = await claimSetup();
    await seedSeat(database, SPONSOR, FRIEND);
    const response = await handler(websiteRequest("/sponsorship/claim", { device_id: awaiting.id, sponsor_code: "SPON-SORC-ODE2" }));
    assert.deepEqual(await body(response), { outcome: "sponsored-approved" });
    assert.equal(await count("sponsorships"), 1);
});

// ---- Sponsor portal, code, remove ----

test("sponsor routes require a live sponsor session", async () => {
    await seedGrant(database, SPONSOR);
    const { handler } = gatewayHandler(database, discordScript({ bot: { [SPONSOR]: { roles: [PATREON_ROLE] } } }));
    const expiredSession = await seedSponsorSession(database, SPONSOR, NOW - 1, "x".repeat(43));
    for (const path of ["/sponsor/portal", "/sponsor/code", "/sponsor/remove"]) {
        for (const [session, error] of [
            [undefined, "authorization_required"],
            ["short", "authorization_required"],
            ["u".repeat(43), "authorization_expired"],
            [expiredSession, "authorization_expired"],
        ] as const) {
            const response = await handler(websiteRequest(path, { session, discord_user_id: FRIEND }));
            assert.deepEqual([response.status, await body(response)], [401, { error }], `${path} ${session}`);
        }
    }
});

test("the portal lists seats in claim order and leaves the seat limit to the shared policy", async () => {
    await seedGrant(database, SPONSOR);
    await seedSeat(database, SPONSOR, FRIEND, NOW - 20);
    await seedSeat(database, SPONSOR, "222222222222222222", NOW - 30);
    const session = await seedSponsorSession(database, SPONSOR);
    const { handler } = gatewayHandler(database, discordScript({ bot: { [SPONSOR]: { roles: [PATREON_ROLE] } } }));
    const response = await handler(websiteRequest("/sponsor/portal", { session }));
    assert.deepEqual([response.status, await body(response)], [200, {
        seats: [
            { discord_user_id: "222222222222222222", created_at: NOW - 30 },
            { discord_user_id: FRIEND, created_at: NOW - 20 },
        ],
    }]);
});

test("the portal is 403 for a sponsor who lost the role, and their session ends", async () => {
    await seedGrant(database, SPONSOR);
    await seedSeat(database, SPONSOR, FRIEND);
    const session = await seedSponsorSession(database, SPONSOR);
    const { handler } = gatewayHandler(database, discordScript({ bot: { [SPONSOR]: { roles: [] } } }));
    const response = await handler(websiteRequest("/sponsor/portal", { session }));
    assert.deepEqual([response.status, await body(response)], [403, { error: "supporter_role_required" }]);
    assert.equal(await count("sponsor_sessions"), 0);
    assert.equal(await count("sponsorships"), 0);
    const again = await handler(websiteRequest("/sponsor/portal", { session }));
    assert.deepEqual([again.status, await body(again)], [401, { error: "authorization_expired" }]);
});

test("a rotated sponsor code is shown once, stored hashed, and redeemable", async () => {
    await seedGrant(database, SPONSOR, "OLDC-ODEA-AAAA");
    const session = await seedSponsorSession(database, SPONSOR);
    const { handler } = gatewayHandler(database, discordScript({ bot: { [SPONSOR]: { roles: [PATREON_ROLE] } } }));
    const response = await handler(websiteRequest("/sponsor/code", { session }));
    assert.equal(response.status, 200);
    const { code } = await body(response) as { code: string };
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.deepEqual(await rows(database, "select sponsor_code_hash, updated_at from nightly_gateway.supporter_grants"), [
        { sponsor_code_hash: await sha256(code), updated_at: NOW },
    ]);
    const awaiting = await seedDevice(database, { status: "awaiting-sponsor", discordUserId: FRIEND });
    const old = await handler(websiteRequest("/sponsorship/claim", { device_id: awaiting.id, sponsor_code: "OLDC-ODEA-AAAA" }));
    assert.equal((await body(old)).error, "invalid_sponsor_code");
    const claimed = await handler(websiteRequest("/sponsorship/claim", { device_id: awaiting.id, sponsor_code: code }));
    assert.deepEqual(await body(claimed), { outcome: "sponsored-approved" });
});

test("removing a seat frees it and ends that friend's download sessions under this sponsor", async () => {
    await seedGrant(database, SPONSOR);
    await seedGrant(database, OTHER_SPONSOR);
    await seedSeat(database, SPONSOR, FRIEND);
    await seedDownloadSession(database, FRIEND, SPONSOR, "1".repeat(43));
    await seedDownloadSession(database, FRIEND, OTHER_SPONSOR, "2".repeat(43));
    const session = await seedSponsorSession(database, SPONSOR);
    const { handler } = gatewayHandler(database, discordScript());
    const invalid = await handler(websiteRequest("/sponsor/remove", { session, discord_user_id: "nope" }));
    assert.deepEqual([invalid.status, await body(invalid)], [400, { error: "invalid_request" }]);
    const response = await handler(websiteRequest("/sponsor/remove", { session, discord_user_id: FRIEND }));
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    assert.equal(await count("sponsorships"), 0);
    assert.deepEqual(await rows(database, "select supporter_discord_user_id from nightly_gateway.download_sessions"), [
        { supporter_discord_user_id: OTHER_SPONSOR },
    ]);
});

// ---- End to end ----

test("an installer, a friend, and a sponsor complete the whole sponsored flow, holding no connection during Discord calls", async () => {
    await seedGrant(database, SPONSOR, "SPON-SORC-ODE2");
    const script = discordScript({ bot: { [SPONSOR]: { roles: [PATREON_ROLE] } } });
    const { handler, pool } = gatewayHandler(database, script);
    script.beforeEachCall = (url) => assert.equal(pool.inUse, false, `${url} runs while a database connection is held`);
    const created = await body(await handler(installerRequest("/v1/device/sessions", "client=installer")));
    const userCode = created.user_code;
    const poll = () => handler(installerRequest("/v1/device/token", `device_code=${created.device_code}`));
    assert.equal((await poll()).status, 428);
    const started = await body(await handler(websiteRequest("/oauth/start", { purpose: "device", user_code: userCode })));
    const state = new URL(started.authorize_url as string).searchParams.get("state");
    const completed = await body(await handler(websiteRequest("/oauth/complete", { code: "code", state })));
    assert.equal(completed.outcome, "needs-sponsor");
    assert.equal((await poll()).status, 428);
    const claimed = await body(await handler(websiteRequest("/sponsorship/claim", { device_id: completed.device_id, sponsor_code: "SPON-SORC-ODE2" })));
    assert.deepEqual(claimed, { outcome: "sponsored-approved" });
    const token = await poll();
    assert.equal(token.status, 200);
    assert.equal((await body(token)).expires_in, 3600);
    assert.equal((await poll()).status, 403);
    assert.ok(script.calls.length >= 4, "the flow re-checked Discord");
});

test("unexpected database failures are a logged 500 with the SQLSTATE, and later requests still work", async () => {
    let clock = () => Number.NaN;
    const { handler, logs } = gatewayHandler(database, discordScript(), () => clock());
    const response = await handler(installerRequest("/v1/device/sessions"));
    assert.deepEqual([response.status, await body(response)], [500, { error: "internal_error" }]);
    clock = () => NOW * 1000;
    assert.equal((await handler(installerRequest("/v1/device/sessions"))).status, 201);
    const [event] = logs;
    assert.deepEqual(Object.keys(event!).sort(), ["cause", "error", "event", "path", "sqlstate"]);
    assert.equal(event!.error, "internal_error");
    assert.equal(typeof event!.cause, "string");
    assert.match(event!.sqlstate as string, /^[0-9A-Z]{5}$/);
});

test("unexpected non-database failures log only the error class", async () => {
    const logs: Record<string, unknown>[] = [];
    const throwing = createNightlyGatewayHandler({
        websiteKey: WEBSITE_KEY,
        discord: { clientId: CLIENT_ID, clientSecret: "s".repeat(32), botToken: BOT_TOKEN },
        fetch,
        database: failingDatabase(() => new TypeError(`secret ${WEBSITE_KEY}`)),
        clock: () => NOW * 1000,
        log: (event) => logs.push(event),
    });
    const response = await throwing(installerRequest("/v1/device/sessions"));
    assert.deepEqual([response.status, await body(response)], [500, { error: "internal_error" }]);
    assert.deepEqual(logs.at(-1), {
        event: "nightly_gateway_request_failed",
        path: "/functions/v1/nightly-gateway/v1/device/sessions",
        error: "internal_error",
        cause: "TypeError",
    });
    assert.ok(!JSON.stringify(logs).includes(WEBSITE_KEY));
});

test("unexpected failures log a snake_case error code from the message, and never any other message text", async () => {
    const logs: Record<string, unknown>[] = [];
    let failure: Error = new Error("postgres_integer_out_of_range");
    const throwing = createNightlyGatewayHandler({
        websiteKey: WEBSITE_KEY,
        discord: { clientId: CLIENT_ID, clientSecret: "s".repeat(32), botToken: BOT_TOKEN },
        fetch,
        database: failingDatabase(() => failure),
        clock: () => NOW * 1000,
        log: (event) => logs.push(event),
    });
    const response = await throwing(installerRequest("/v1/device/sessions"));
    assert.deepEqual([response.status, await body(response)], [500, { error: "internal_error" }]);
    assert.deepEqual(logs.at(-1), {
        event: "nightly_gateway_request_failed",
        path: "/functions/v1/nightly-gateway/v1/device/sessions",
        error: "internal_error",
        cause: "Error",
        message: "postgres_integer_out_of_range",
    });
    for (const unsafe of ["Postgres_Out_Of_Range", "out of range", "x".repeat(65), `leaked_${"k".repeat(60)}`, ""]) {
        failure = new Error(unsafe);
        await throwing(installerRequest("/v1/device/sessions"));
        assert.equal(logs.at(-1)!.message, undefined, `message ${JSON.stringify(unsafe)} is not logged`);
    }
});

test("unexpected driver failures name the failing dependency by its errno code, never its message", async () => {
    const logs: Record<string, unknown>[] = [];
    let failure: Error = new Error("unset");
    const throwing = createNightlyGatewayHandler({
        websiteKey: WEBSITE_KEY,
        discord: { clientId: CLIENT_ID, clientSecret: "s".repeat(32), botToken: BOT_TOKEN },
        fetch,
        database: failingDatabase(() => failure),
        clock: () => NOW * 1000,
        log: (event) => logs.push(event),
    });
    for (const code of ["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET"]) {
        failure = Object.assign(new Error(`connect ${code} 10.0.0.1:5432 secret-host`), { code });
        await throwing(installerRequest("/v1/device/sessions"));
        assert.deepEqual(logs.at(-1), {
            event: "nightly_gateway_request_failed",
            path: "/functions/v1/nightly-gateway/v1/device/sessions",
            error: "internal_error",
            cause: "Error",
            code,
        });
    }
    for (const code of ["econnrefused", "ERR_SOCKET_CLOSED", "E1", `E${"X".repeat(21)}`, 111]) {
        failure = Object.assign(new Error("secret-host"), { code });
        await throwing(installerRequest("/v1/device/sessions"));
        assert.deepEqual(Object.keys(logs.at(-1)!).sort(), ["cause", "error", "event", "path"], `code ${String(code)} is not logged`);
    }
    assert.ok(!JSON.stringify(logs).includes("secret-host"));
});

test("a pool that cannot connect logs nightly_database_unavailable with the errno code, for statements and transactions alike", async () => {
    await seedGrant(database, SPONSOR);
    const session = await seedSponsorSession(database, SPONSOR);
    const shared = new SingleConnectionPool(database);
    let leasesLeft = 0;
    const refusingPool: ConnectionPool = {
        connect: async () => {
            if (leasesLeft <= 0) throw Object.assign(new Error("connect ECONNREFUSED secret-host"), { code: "ECONNREFUSED" });
            leasesLeft -= 1;
            return shared.connect();
        },
    };
    const logs: Record<string, unknown>[] = [];
    const handler = createNightlyGatewayHandler({
        websiteKey: WEBSITE_KEY,
        discord: { clientId: CLIENT_ID, clientSecret: "s".repeat(32), botToken: BOT_TOKEN },
        fetch,
        database: pooledGatewayDatabase(refusingPool),
        clock: () => NOW * 1000,
        log: (event) => logs.push(event),
    });
    const unavailable = { error: "internal_error", cause: "DatabaseUnavailableError", message: "nightly_database_unavailable", code: "ECONNREFUSED" };

    const created = await handler(installerRequest("/v1/device/sessions"));
    assert.deepEqual([created.status, await body(created)], [500, { error: "internal_error" }]);
    assert.deepEqual(logs.at(-1), {
        event: "nightly_gateway_request_failed", path: "/functions/v1/nightly-gateway/v1/device/sessions", ...unavailable,
    }, "a single-statement route");

    leasesLeft = 1; // The session lookup gets its connection; the removal's transaction does not.
    const removed = await handler(websiteRequest("/sponsor/remove", { session, discord_user_id: FRIEND }));
    assert.deepEqual([removed.status, await body(removed)], [500, { error: "internal_error" }]);
    assert.equal(leasesLeft, 0);
    assert.deepEqual(logs.at(-1), { event: "nightly_gateway_request_failed", path: "/nightly-gateway/sponsor/remove", ...unavailable }, "a transaction");
    assert.ok(!JSON.stringify(logs).includes("secret-host"));
});
