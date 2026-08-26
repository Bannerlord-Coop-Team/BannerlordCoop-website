import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
    CREATE_BUILD_PIN_KIND,
    createBuildPinToken,
} from "./core";
import worker, {
    serveCreateBuildPinLauncher,
    serveCreateBuildPinPage,
} from "./index";

const gateway = "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev";
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

type PinRow = {
    token_hash: string;
    build_id: string;
    client_sha: string;
    server_sha: string;
    client_file_name: string;
    client_bytes: number;
    client_sha256: string;
    server_file_name: string;
    server_key: string;
    server_public_url: string;
    server_bytes: number;
    server_sha256: string;
    created_at: number;
    expires_at: number;
    consumed_at: number | null;
};

type PinSession = {
    token_hash: string;
    pin_token_hash: string;
    created_at: number;
    expires_at: number;
};

type NightlySession = {
    token_hash: string;
    expires_at: number;
};

function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function pinEnvironment(): {
    env: Env;
    objects: Map<string, Uint8Array>;
    nightlySessions: NightlySession[];
} {
    const pins: PinRow[] = [];
    const sessions: PinSession[] = [];
    const nightlySessions: NightlySession[] = [];
    const objects = new Map<string, Uint8Array>();
    const database = {
        prepare(sql: string) {
            const statement = {
                args: [] as unknown[],
                bind(...args: unknown[]) {
                    statement.args = args;
                    return statement;
                },
                async first<T>() {
                    if (sql.includes("FROM installer_pins WHERE build_id = ?")) {
                        return (pins.find((pin) => pin.build_id === statement.args[0]) ?? null) as T;
                    }
                    if (sql.includes("FROM installer_pins WHERE token_hash = ?")) {
                        return (pins.find((pin) => pin.token_hash === statement.args[0]) ?? null) as T;
                    }
                    if (sql.includes("FROM pin_download_sessions") && sql.includes("JOIN installer_pins")) {
                        const session = sessions.find((entry) => entry.token_hash === statement.args[0]);
                        if (session === undefined) return null as T;
                        const pin = pins.find((entry) => entry.token_hash === session.pin_token_hash);
                        if (pin === undefined) return null as T;
                        return {
                            build_id: pin.build_id,
                            session_expires_at: session.expires_at,
                            pin_expires_at: pin.expires_at,
                        } as T;
                    }
                    if (sql.includes("FROM download_sessions WHERE token_hash")) {
                        return (nightlySessions.find((entry) => entry.token_hash === statement.args[0]) ?? null) as T;
                    }
                    throw new Error(`Unexpected test query: ${sql}`);
                },
                async run() {
                    if (sql.includes("INSERT INTO installer_pins")) {
                        const [
                            tokenHash, buildId, clientSha, serverSha, clientFileName, clientBytes,
                            clientSha256, serverFileName, serverKey, serverPublicUrl, serverBytes,
                            serverSha256, createdAt, expiresAt,
                        ] = statement.args;
                        pins.push({
                            token_hash: String(tokenHash),
                            build_id: String(buildId),
                            client_sha: String(clientSha),
                            server_sha: String(serverSha),
                            client_file_name: String(clientFileName),
                            client_bytes: Number(clientBytes),
                            client_sha256: String(clientSha256),
                            server_file_name: String(serverFileName),
                            server_key: String(serverKey),
                            server_public_url: String(serverPublicUrl),
                            server_bytes: Number(serverBytes),
                            server_sha256: String(serverSha256),
                            created_at: Number(createdAt),
                            expires_at: Number(expiresAt),
                            consumed_at: null,
                        });
                        return { success: true, meta: { changes: 1 } };
                    }
                    if (sql.includes("UPDATE installer_pins SET consumed_at")) {
                        const [consumedAt, tokenHash, now] = statement.args;
                        const pin = pins.find((entry) =>
                            entry.token_hash === tokenHash
                            && entry.consumed_at === null
                            && entry.expires_at > Number(now));
                        if (pin === undefined) return { success: true, meta: { changes: 0 } };
                        pin.consumed_at = Number(consumedAt);
                        return { success: true, meta: { changes: 1 } };
                    }
                    if (sql.includes("INSERT INTO pin_download_sessions")) {
                        const [sessionHash, createdAt, expiresAt, pinHash, consumedAt] = statement.args;
                        const pin = pins.find((entry) =>
                            entry.token_hash === pinHash && entry.consumed_at === Number(consumedAt));
                        if (pin === undefined) return { success: true, meta: { changes: 0 } };
                        sessions.push({
                            token_hash: String(sessionHash),
                            pin_token_hash: String(pinHash),
                            created_at: Number(createdAt),
                            expires_at: Number(expiresAt),
                        });
                        return { success: true, meta: { changes: 1 } };
                    }
                    throw new Error(`Unexpected test mutation: ${sql}`);
                },
            };
            return statement;
        },
        async batch(entries: Array<{ run(): Promise<{ success: boolean; meta?: { changes: number } }> }>) {
            const results = [];
            for (const entry of entries) results.push(await entry.run());
            return results;
        },
    };
    return {
        objects,
        nightlySessions,
        env: {
            DB: database,
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
            DISCORD_BOT_TOKEN: "B".repeat(59),
            DISCORD_CLIENT_ID: "1537575576745803799",
            DISCORD_CLIENT_SECRET: "test-secret-value-that-is-long-enough",
            PUBLIC_ORIGIN: gateway,
            LEGACY_R2_ORIGIN: legacy,
            TOKEN_ENCRYPTION_KEY: "A".repeat(43),
            PIN_MINT_SECRET: PIN_SECRET,
        } as unknown as Env,
    };
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

function mintRequest(envSecret = PIN_SECRET, body = metadata(), archive: Buffer = CLIENT_ARCHIVE): Request {
    const form = new FormData();
    form.set("metadata", JSON.stringify(body));
    form.set("client", new File([archive], "Coop.7z"));
    return new Request(`${gateway}/v1/pins`, {
        method: "POST",
        headers: { authorization: `Bearer ${envSecret}` },
        body: form,
    });
}

async function fetchGateway(request: Request, env: Env): Promise<Response> {
    return worker.fetch(request, env, {} as ExecutionContext);
}

test("the bot can mint a create-build pin and the installer can redeem it once", async () => {
    const { env, objects } = pinEnvironment();
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

    const page = await serveCreateBuildPinPage(new URL(payload.installUrl), env);
    assert.equal(page.status, 200);
    const markup = await page.text();
    assert.match(markup, /Install this <span>exact<\/span> build/);
    assert.match(markup, new RegExp(CLIENT_SHA.slice(0, 7)));
    assert.match(markup, /v1\/pins\/install\.cmd\?pin=/);

    const launcher = await serveCreateBuildPinLauncher(new URL(`${gateway}/v1/pins/install.cmd?pin=${payload.token}`), env);
    assert.equal(launcher.status, 200);
    const cmd = await launcher.text();
    assert.match(cmd, new RegExp(`BANNERLORDCOOP_INSTALLER_PIN=${payload.token}`));
    assert.match(cmd, /Create-Build Installer/);

    const stillVisible = await serveCreateBuildPinPage(new URL(payload.installUrl), env);
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

    const usedPage = await serveCreateBuildPinPage(new URL(payload.installUrl), env);
    assert.equal(usedPage.status, 400);
    assert.match(await usedPage.text(), /already used/);
});

test("a nightly download session cannot read a create-build pin artifact", async () => {
    const { env, nightlySessions } = pinEnvironment();
    assert.equal((await fetchGateway(mintRequest(), env)).status, 201);
    const nightlyToken = "n".repeat(43);
    nightlySessions.push({
        token_hash: sha256(nightlyToken),
        expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    const response = await fetchGateway(new Request(`${gateway}/v1/artifacts/pins/${BUILD_ID}/Coop.7z`, {
        headers: { authorization: `Bearer ${nightlyToken}` },
    }), env);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_artifact" });
});

test("a create-build pin session cannot read a nightly artifact", async () => {
    const { env } = pinEnvironment();
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
    const { env } = pinEnvironment();
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

test("migration mode fails closed before any gateway state can change", async () => {
    const { env } = pinEnvironment();
    const locked = { ...env, MIGRATION_MODE: "locked" as const };
    const health = await fetchGateway(new Request(`${gateway}/health`), locked);
    assert.equal(health.status, 503);
    assert.deepEqual(await health.json(), { ok: false, maintenance: true });

    const create = await fetchGateway(new Request(`${gateway}/v1/device/sessions`, { method: "POST" }), locked);
    assert.equal(create.status, 503);
    assert.deepEqual(await create.json(), { error: "migration_in_progress" });
});
