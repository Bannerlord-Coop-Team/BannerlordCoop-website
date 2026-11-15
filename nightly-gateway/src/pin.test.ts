import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import {
    clearGatewayTables,
    FRIEND,
    SPONSOR,
    seedDownloadSession,
    seedGrant,
} from "../../supabase/functions/nightly-gateway/test-harness.ts";
import {
    CREATE_BUILD_PIN_KIND,
    createBuildPinToken,
} from "./pin-rules";
import type { RequestEnv } from "./database";
import { createGateway } from "./index";
import { serveCreateBuildPinLauncher, serveCreateBuildPinPage } from "./pins";
import { createWorkerSchemaDatabase, workerDatabase } from "./postgres-test-database";

const gateway = "https://nightly.bannerlordcoop.com";
const legacyGateway = "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev";
const legacy = "https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev";
const BUILD_ID = "1527333818711806084";
const CLIENT_SHA = "1234567890abcdef1234567890abcdef12345678";
const SERVER_SHA = "abcdef1234567890abcdef1234567890abcdef12";
const PIN_SECRET = "pin-mint-secret-value-32-bytes-min";
const CLIENT_ARCHIVE = Buffer.from("create-build-client");
const CLIENT_SHA256 = createHash("sha256").update(CLIENT_ARCHIVE).digest("hex");
const SERVER_FILE = "BannerlordCoop-DedicatedServer-Win64-client-1234567-server-abcdef1.7z";
const SERVER_KEY = `manual/${BUILD_ID}/${SERVER_FILE}`;
const SERVER_SHA256 = "c".repeat(64);

// One in-process PostgreSQL with the real gateway schema, emptied before each test's environment is built.
let database: PGlite;

before(async () => {
    database = await createWorkerSchemaDatabase();
});

after(async () => {
    await database.close();
});

// The Worker under test: pin routes never call upstream, and each request opens the PGlite-backed database.
const worker = createGateway({
    fetch: () => Promise.reject(new Error("pin routes must not call upstream")),
    openDatabase: async () => workerDatabase(database),
});

// Empties every gateway table and builds the Worker bindings around an in-memory R2 bucket.
async function pinEnvironment(): Promise<{ env: Env; objects: Map<string, Uint8Array> }> {
    await clearGatewayTables(database);
    await database.exec("truncate nightly_gateway.installer_pins, nightly_gateway.pin_download_sessions cascade");
    const objects = new Map<string, Uint8Array>();
    return {
        objects,
        env: {
            RELEASES: {
                async put(key: string, value: ArrayBuffer | ArrayBufferView | string) {
                    const bytes = typeof value === "string"
                        ? new TextEncoder().encode(value)
                        : value instanceof ArrayBuffer
                            ? new Uint8Array(value)
                            : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
                    objects.set(key, bytes);
                    return {};
                },
                async get(key: string) {
                    const bytes = objects.get(key);
                    if (bytes === undefined) return null;
                    return {
                        size: bytes.byteLength,
                        async arrayBuffer() {
                            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
                        },
                    };
                },
            },
            LEGACY_R2_ORIGIN: legacy,
            NIGHTLY_FUNCTION_URL: "https://example.supabase.co/functions/v1/nightly-gateway",
            PIN_MINT_SECRET: PIN_SECRET,
        } as unknown as Env,
    };
}

// Gives a handler called directly the request-scoped database the Worker would have opened for it.
function withDatabase(env: Env): RequestEnv {
    return { ...env, DB: workerDatabase(database) };
}

function metadata() {
    return {
        buildId: BUILD_ID,
        clientSha: CLIENT_SHA,
        serverSha: SERVER_SHA,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        client: {
            fileName: "Coop.7z",
            bytes: CLIENT_ARCHIVE.byteLength,
            sha256: CLIENT_SHA256,
        },
        server: {
            fileName: SERVER_FILE,
            key: SERVER_KEY,
            publicUrl: `${legacy}/${SERVER_KEY}`,
            bytes: 4_000_000_000,
            sha256: SERVER_SHA256,
        },
    };
}

function mintRequest(
    envSecret = PIN_SECRET,
    body = metadata(),
    archive: Buffer = CLIENT_ARCHIVE,
    origin = gateway,
): Request {
    const form = new FormData();
    form.set("metadata", JSON.stringify(body));
    form.set("client", new File([archive], "Coop.7z"));
    return new Request(`${origin}/v1/pins`, {
        method: "POST",
        headers: { authorization: `Bearer ${envSecret}` },
        body: form,
    });
}

// Sends one request through the Worker's fetch handler.
async function fetchGateway(request: Request, env: Env): Promise<Response> {
    return worker.fetch(request, env, {} as ExecutionContext);
}

// Builds the installer's pin redemption request.
function redeemRequest(token: string, origin = gateway): Request {
    return new Request(`${origin}/v1/pins/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `pin=${token}`,
    });
}

// Reads one installer_pins row's consumption time straight from the schema.
async function consumedAt(buildId: string): Promise<number | null> {
    const result = await database.query<{ consumed_at: number | null }>(
        "SELECT consumed_at FROM nightly_gateway.installer_pins WHERE build_id = $1",
        [buildId],
    );
    return result.rows[0]?.consumed_at ?? null;
}

test("the bot can mint a create-build pin and the installer can redeem it once", async () => {
    const { env, objects } = await pinEnvironment();
    const body = metadata();
    const minted = await fetchGateway(mintRequest(PIN_SECRET, body), env);
    assert.equal(minted.status, 201);
    const payload = await minted.json() as { token: string; installUrl: string; expiresAt: string };
    const expectedToken = await createBuildPinToken(PIN_SECRET, BUILD_ID, CLIENT_SHA256, SERVER_SHA256);
    assert.equal(payload.token, expectedToken);
    assert.equal(payload.installUrl, `${gateway}/install?pin=${expectedToken}`);
    assert.equal(objects.get(`pins/${BUILD_ID}/Coop.7z`)?.byteLength, CLIENT_ARCHIVE.byteLength);

    const reminted = await fetchGateway(mintRequest(PIN_SECRET, body), env);
    assert.equal(reminted.status, 200);
    assert.deepEqual(await reminted.json(), payload);

    const page = await serveCreateBuildPinPage(new URL(payload.installUrl), withDatabase(env));
    assert.equal(page.status, 200);
    const markup = await page.text();
    assert.match(markup, /Install this <span>exact<\/span> build/);
    assert.match(markup, new RegExp(CLIENT_SHA.slice(0, 7)));
    assert.match(markup, /v1\/pins\/install\.cmd\?pin=/);

    const launcher = await serveCreateBuildPinLauncher(new URL(`${gateway}/v1/pins/install.cmd?pin=${payload.token}`), withDatabase(env));
    assert.equal(launcher.status, 200);
    const cmd = await launcher.text();
    assert.match(cmd, new RegExp(`BANNERLORDCOOP_INSTALLER_PIN=${payload.token}`));
    assert.match(cmd, /Create-Build Installer/);
    assert.ok(cmd.includes(`set "INSTALLER_PRIMARY=${gateway}/install.ps1"\r\n`));
    assert.ok(cmd.includes(
        'set "INSTALLER_MIRROR=https://raw.githubusercontent.com/Bannerlord-Coop-Team/BannerlordCoop-website/main/installer/install.ps1"',
    ));

    const stillVisible = await serveCreateBuildPinPage(new URL(payload.installUrl), withDatabase(env));
    assert.equal(stillVisible.status, 200);

    const redeemed = await fetchGateway(new Request(`${gateway}/v1/pins/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `pin=${payload.token}`,
    }), env);
    assert.equal(redeemed.status, 200);
    const session = await redeemed.json() as { access_token: string; token_type: string };
    assert.equal(session.token_type, "Bearer");
    assert.match(session.access_token, /^[A-Za-z0-9_-]{43}$/);

    const manifestResponse = await fetchGateway(new Request(`${gateway}/v1/manifests/pin`, {
        headers: { authorization: `Bearer ${session.access_token}` },
    }), env);
    assert.equal(manifestResponse.status, 200);
    const manifest = await manifestResponse.json() as {
        kind: string;
        clientSha: string;
        serverSha: string;
        client: { publicUrl: string; sha256: string };
        server: { publicUrl: string };
    };
    assert.equal(manifest.kind, CREATE_BUILD_PIN_KIND);
    assert.equal(manifest.clientSha, CLIENT_SHA);
    assert.equal(manifest.serverSha, SERVER_SHA);
    assert.equal(manifest.client.sha256, CLIENT_SHA256);
    assert.equal(
        manifest.client.publicUrl,
        `${gateway}/v1/artifacts/pins/${BUILD_ID}/Coop.7z`,
    );
    assert.equal(manifest.server.publicUrl, `${legacy}/${SERVER_KEY}`);

    const reused = await fetchGateway(new Request(`${gateway}/v1/pins/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `pin=${payload.token}`,
    }), env);
    assert.equal(reused.status, 409);
    assert.deepEqual(await reused.json(), { error: "already_used" });
    assert.notEqual(await consumedAt(BUILD_ID), null);

    const usedPage = await serveCreateBuildPinPage(new URL(payload.installUrl), withDatabase(env));
    assert.equal(usedPage.status, 400);
    assert.match(await usedPage.text(), /already used/);
});

test("a redemption whose download session cannot be written rolls back and leaves the pin redeemable", async () => {
    const { env } = await pinEnvironment();
    const minted = await fetchGateway(mintRequest(), env);
    const { token } = await minted.json() as { token: string };
    await database.exec(`
        CREATE FUNCTION nightly_gateway.refuse_pin_session() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'pin_session_insert_refused'; END $$;
        CREATE TRIGGER refuse_pin_session BEFORE INSERT ON nightly_gateway.pin_download_sessions
            FOR EACH ROW EXECUTE FUNCTION nightly_gateway.refuse_pin_session();
    `);
    try {
        const failed = await fetchGateway(redeemRequest(token), env);
        assert.equal(failed.status, 500);
        assert.equal(await consumedAt(BUILD_ID), null);
    } finally {
        await database.exec(`
            DROP TRIGGER refuse_pin_session ON nightly_gateway.pin_download_sessions;
            DROP FUNCTION nightly_gateway.refuse_pin_session();
        `);
    }

    const redeemed = await fetchGateway(redeemRequest(token), env);
    assert.equal(redeemed.status, 200);
    assert.notEqual(await consumedAt(BUILD_ID), null);
});

test("a nightly download session cannot read a create-build pin artifact", async () => {
    const { env } = await pinEnvironment();
    assert.equal((await fetchGateway(mintRequest(), env)).status, 201);
    const nightlyToken = "n".repeat(43);
    await seedGrant(database, SPONSOR);
    await seedDownloadSession(database, FRIEND, SPONSOR, nightlyToken);
    const response = await fetchGateway(new Request(`${gateway}/v1/artifacts/pins/${BUILD_ID}/Coop.7z`, {
        headers: { authorization: `Bearer ${nightlyToken}` },
    }), env);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_artifact" });
});

test("a create-build pin session cannot read a nightly artifact", async () => {
    const { env } = await pinEnvironment();
    const minted = await fetchGateway(mintRequest(), env);
    const { token } = await minted.json() as { token: string };
    const redeemed = await fetchGateway(new Request(`${gateway}/v1/pins/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `pin=${token}`,
    }), env);
    const { access_token: accessToken } = await redeemed.json() as { access_token: string };
    const nightlyManifest = await fetchGateway(new Request(`${gateway}/v1/manifests/client`, {
        headers: { authorization: `Bearer ${accessToken}` },
    }), env);
    assert.equal(nightlyManifest.status, 403);
    const nightlyArtifact = await fetchGateway(new Request(`${gateway}/v1/artifacts/nightly/Coop.7z`, {
        headers: { authorization: `Bearer ${accessToken}` },
    }), env);
    assert.equal(nightlyArtifact.status, 400);
    assert.deepEqual(await nightlyArtifact.json(), { error: "invalid_artifact" });
});

test("pin mint rejects a missing or wrong shared secret", async () => {
    const { env } = await pinEnvironment();
    const missing = await fetchGateway(new Request(`${gateway}/v1/pins`, {
        method: "POST",
        body: new FormData(),
    }), env);
    assert.equal(missing.status, 401);
    const wrong = await fetchGateway(mintRequest("wrong-mint-secret-value-32-bytes-min"), env);
    assert.equal(wrong.status, 401);
    const unavailable = await fetchGateway(mintRequest(), {
        ...env,
        PIN_MINT_SECRET: undefined,
    });
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { error: "pin_mint_unavailable" });
});

test("create-build pins keep install links, manifests, and launchers on the allowlisted host that was used", async () => {
    const cases = [
        { origin: gateway, expected: gateway },
        { origin: legacyGateway, expected: legacyGateway },
        { origin: "https://gateway.attacker.invalid", expected: gateway },
    ];
    for (const { origin, expected } of cases) {
        const { env } = await pinEnvironment();
        const minted = await fetchGateway(mintRequest(PIN_SECRET, metadata(), CLIENT_ARCHIVE, origin), env);
        assert.equal(minted.status, 201);
        const { token, installUrl } = await minted.json() as { token: string; installUrl: string };
        assert.equal(installUrl, `${expected}/install?pin=${token}`, origin);

        const page = await fetchGateway(new Request(installUrl), env);
        assert.equal(page.status, 200);
        assert.match(await page.text(), /href="\/v1\/pins\/install\.cmd\?pin=/);

        const launcher = await fetchGateway(new Request(`${origin}/v1/pins/install.cmd?pin=${token}`), env);
        assert.equal(launcher.status, 200);
        assert.ok((await launcher.text()).includes(`set "INSTALLER_PRIMARY=${expected}/install.ps1"\r\n`), origin);

        const redeemed = await fetchGateway(new Request(`${origin}/v1/pins/token`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: `pin=${token}`,
        }), env);
        const { access_token: accessToken } = await redeemed.json() as { access_token: string };
        const manifest = await fetchGateway(new Request(`${origin}/v1/manifests/pin`, {
            headers: { authorization: `Bearer ${accessToken}` },
        }), env);
        const body = await manifest.json() as { client: { publicUrl: string }; server: { publicUrl: string } };
        assert.equal(body.client.publicUrl, `${expected}/v1/artifacts/pins/${BUILD_ID}/Coop.7z`, origin);
        assert.equal(body.server.publicUrl, `${legacy}/${SERVER_KEY}`);
    }
});
