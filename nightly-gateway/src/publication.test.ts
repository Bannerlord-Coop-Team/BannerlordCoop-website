import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateLegacyNightlyClientManifest, validateLegacyNightlyReleaseManifest, validateNightlyPublicationPointer } from "./manifest-rules";
import { CANONICAL_GATEWAY_ORIGIN } from "./origins";
import { NIGHTLY_POINTER_URL, NightlyPublicationReadError, readNightlyPublication } from "./publication";
import type { GatewayDatabase } from "./database";
import { createGateway } from "./index";
import { noLog } from "./test-log";

const origin = "https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev";
const repository = "ghcr.io/bannerlord-coop-team/bannerlord-coop-dedicated-server";

// Stands in for Postgres with one live nightly download session; manifest discovery must never write.
function nightlySessionDatabase(): GatewayDatabase {
    return {
        async query<T>(sql: string) {
            if (!/^\s*SELECT/.test(sql)) throw new Error("manifest discovery must be read-only");
            if (!sql.includes("FROM nightly_gateway.download_sessions")) return { rows: [], rowCount: 0 };
            return { rows: [{ expires_at: Math.floor(Date.now() / 1000) + 60 }] as T[], rowCount: 1 };
        },
        async transaction() { throw new Error("manifest discovery must be read-only"); },
    };
}

function fixture() {
    const clientSha = "a".repeat(40);
    const serverSha = "b".repeat(40);
    const digest = `sha256:${"9".repeat(64)}`;
    const artifact = (key: string, sha256: string) => ({ fileName: "test.7z", key, bytes: 10, sha256, publicUrl: `${origin}/${key}` });
    const manifest = {
        version: 2, kind: "bannerlordcoop-nightly-publication", releaseDate: "2026-11-04", builtAt: "2026-11-04T12:34:56Z",
        headSha: clientSha, serverSha, clientRunId: "12345678901", serverRunId: "12345678902",
        client: artifact(`nightly/clients/${clientSha}/${"c".repeat(64)}/Coop.7z`, "c".repeat(64)),
        server: {
            ...artifact(`nightly/windows/full/${clientSha}/${serverSha}/${"d".repeat(64)}/BannerlordCoop-DedicatedServer-Win64.7z`, "d".repeat(64)),
            incremental: {
                version: 1, layout: "base-overlay-v1", baseFingerprint: "1".repeat(64), compatibleBaseFingerprints: [],
                base: artifact(`windows/base/v1/${"1".repeat(64)}/${"e".repeat(64)}/server-base.7z`, "e".repeat(64)),
                update: artifact(`nightly/windows/updates/${clientSha}/${serverSha}/${"f".repeat(64)}/server-update.7z`, "f".repeat(64)),
            },
        },
        container: {
            repository, manifestDigest: digest, digestReference: `${repository}@${digest}`,
            immutableReference: `${repository}:nightly-${serverSha.slice(0, 12)}-${clientSha.slice(0, 12)}-${digest.slice(7)}`,
        },
    };
    const bytes = Buffer.from(JSON.stringify(manifest));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const pointer = {
        version: 1, kind: "bannerlordcoop-nightly-pointer",
        manifest: { key: `nightly/publications/${sha256}/release.json`, sha256 },
        container: { repository, manifestDigest: digest, digestReference: `${repository}@${digest}` },
    };
    const pointerBytes = Buffer.from(`${JSON.stringify(pointer)}\n`);
    const requests: Array<{ url: string; options: RequestInit | undefined }> = [];
    const objects: string[] = [];
    const fetcher: typeof fetch = async (input, options) => {
        requests.push({ url: String(input), options });
        return Response.json(pointer);
    };
    const getObject = async (key: string) => {
        objects.push(key);
        return { size: bytes.byteLength, body: new Response(bytes).body! };
    };
    return { manifest, bytes, pointer, pointerBytes, requests, objects, fetcher, getObject };
}

test("gateway reads the exact public pointer and its hash-bound private object", async () => {
    const value = fixture();
    assert.deepEqual(await readNightlyPublication(value.getObject, value.fetcher), value.manifest);
    assert.equal(NIGHTLY_POINTER_URL, `${origin}/nightly/release.json`);
    assert.equal(value.requests.length, 1);
    assert.equal(value.requests[0].url, `${origin}/nightly/release.json`);
    assert.deepEqual(value.requests[0].options, {
        method: "GET", redirect: "manual", signal: value.requests[0].options?.signal,
        headers: { "Cache-Control": "no-cache" },
    });
    assert.ok(value.requests[0].options?.signal instanceof AbortSignal);
    assert.deepEqual(value.objects, [value.pointer.manifest.key]);
    assert.deepEqual(Object.keys(value.pointer).sort(), ["container", "kind", "manifest", "version"]);
});

test("gateway reads the pointer through the public R2 binding without an HTTP redirect", async () => {
    const value = fixture();
    const requests: string[] = [];
    const getPublicPointer = async () => ({
        size: value.pointerBytes.byteLength,
        body: new Response(value.pointerBytes).body!,
    });
    const fetcher: typeof fetch = async (input) => {
        requests.push(String(input));
        throw new Error("the bound pointer path must not fetch the public URL");
    };
    assert.deepEqual(await readNightlyPublication(value.getObject, fetcher, getPublicPointer), value.manifest);
    assert.deepEqual(requests, []);
    assert.deepEqual(value.objects, [value.pointer.manifest.key]);
});

test("both authenticated manifest routes select the same pointer and keep private JSON inaccessible", async () => {
    const value = fixture();
    const gateway = "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev";
    const env = {
        RELEASES: { get: value.getObject },
        LEGACY_R2_ORIGIN: origin,
    } as unknown as Env;
    const manifestGateway = createGateway({ fetch: value.fetcher, openDatabase: async () => nightlySessionDatabase(), log: noLog });
    const headers = {
        authorization: `Bearer ${"n".repeat(43)}`,
        "x-bannerlord-coop-nightly-version": "2",
    };
    for (const path of ["client", "release"]) {
        const response = await manifestGateway.fetch(new Request(`${gateway}/v1/manifests/${path}`, { headers }), env);
        assert.equal(response.status, 200);
        const manifest = await response.json() as { version: number; client: { publicUrl: string } };
        assert.equal(manifest.version, 2);
        assert.equal(manifest.client.publicUrl, `${gateway}/v1/artifacts/${value.manifest.client.key}`);
    }
    assert.deepEqual(value.objects, [value.pointer.manifest.key, value.pointer.manifest.key]);
    assert.deepEqual(value.requests.map(({ url }) => url), [NIGHTLY_POINTER_URL, NIGHTLY_POINTER_URL]);
    const anonymous = await manifestGateway.fetch(new Request(`${gateway}/v1/manifests/release`), env);
    assert.equal(anonymous.status, 401);
    const privateJson = await manifestGateway.fetch(new Request(`${gateway}/v1/artifacts/${value.pointer.manifest.key}`, { headers }), env);
    assert.equal(privateJson.status, 400);
    assert.equal(value.requests.length, 2);
});

test("client and release routes fall back only to a validated legacy pair", async () => {
    const value = fixture();
    const gateway = "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev";
    const legacy = {
        version: 1,
        releaseDate: "2026-11-04",
        headSha: "a".repeat(40),
        baseSha: "a".repeat(40),
        workflowRunId: 42007050452,
        builtAt: "2026-11-05T10:04:43Z",
        client: {
            fileName: "Coop 11-04-2026.7z",
            key: `nightly/clients/${"a".repeat(40)}/${"c".repeat(64)}/Coop.7z`,
            bytes: 10,
            sha256: "c".repeat(64),
            publicUrl: `${gateway}/v1/artifacts/nightly/clients/${"a".repeat(40)}/${"c".repeat(64)}/Coop.7z`,
        },
    };
    const legacyRelease = {
        version: 1,
        releaseDate: legacy.releaseDate,
        headSha: legacy.headSha,
        builtAt: legacy.builtAt,
        client: legacy.client,
        server: {
            fileName: "BannerlordCoop-DedicatedServer-Win64-2026-11-04-coop-e2057ad.7z",
            bytes: 20,
            sha256: "d".repeat(64),
            publicUrl: `${origin}/nightly/BannerlordCoop-DedicatedServer-Win64.7z`,
            incremental: {
                version: 1,
                layout: "base-overlay-v1",
                baseFingerprint: "e".repeat(64),
                compatibleBaseFingerprints: [],
                base: {
                    fileName: "BannerlordCoop-DedicatedServer-Win64-Base.7z",
                    bytes: 30,
                    sha256: "f".repeat(64),
                    publicUrl: `${origin}/windows/base/v1/${"e".repeat(64)}/${"f".repeat(64)}/server-base.7z`,
                    key: `windows/base/v1/${"e".repeat(64)}/${"f".repeat(64)}/server-base.7z`,
                },
                update: {
                    fileName: "BannerlordCoop-DedicatedServer-Win64-Update.7z",
                    bytes: 40,
                    sha256: "0".repeat(64),
                    publicUrl: `${origin}/nightly/windows/updates/${legacy.headSha}/${"a".repeat(40)}/${"0".repeat(64)}/server-update.7z`,
                    key: `nightly/windows/updates/${legacy.headSha}/${"a".repeat(40)}/${"0".repeat(64)}/server-update.7z`,
                },
            },
        },
    };
    const legacyBytes = Buffer.from(JSON.stringify(legacy));
    const legacyReleaseBytes = Buffer.from(JSON.stringify(legacyRelease));
    const objects: string[] = [];
    const env = {
        RELEASES: { async get(key: string) {
            objects.push(key);
            if (key === "nightly/client.json") return {
                size: legacyBytes.byteLength,
                body: new Response(legacyBytes).body!,
                arrayBuffer: async () => legacyBytes.buffer.slice(
                    legacyBytes.byteOffset,
                    legacyBytes.byteOffset + legacyBytes.byteLength,
                ),
            };
            if (key === "nightly/release.json") return {
                size: legacyReleaseBytes.byteLength,
                body: new Response(legacyReleaseBytes).body!,
                arrayBuffer: async () => legacyReleaseBytes.buffer.slice(
                    legacyReleaseBytes.byteOffset,
                    legacyReleaseBytes.byteOffset + legacyReleaseBytes.byteLength,
                ),
            };
            throw new Error("runtime_binding_read_failed");
        } },
        LEGACY_R2_ORIGIN: origin,
    } as unknown as Env;
    const logs: Array<Record<string, unknown>> = [];
    const logged = createGateway({ fetch: value.fetcher, log: (event) => logs.push(event), openDatabase: async () => nightlySessionDatabase() });
    const headers = {
        authorization: `Bearer ${"n".repeat(43)}`,
        "x-bannerlord-coop-nightly-version": "2",
    };
    const client = await logged.fetch(new Request(`${gateway}/v1/manifests/client`, { headers }), env);
    assert.equal(client.status, 200);
    assert.equal((await client.json() as { headSha: string }).headSha, legacy.headSha);
    const release = await logged.fetch(new Request(`${gateway}/v1/manifests/release`, { headers }), env);
    assert.equal(release.status, 200, JSON.stringify(logs));
    assert.equal((await release.json() as { headSha: string }).headSha, legacyRelease.headSha);
    const publicationFailure = logs.find((event) => event.event === "nightly_publication_read_failed"
        && event.route === "release");
    assert.deepEqual(publicationFailure, {
        event: "nightly_publication_read_failed",
        route: "release",
        error_code: "runtime_binding_read_failed",
        stage: "private_read",
        r2_status: null,
        exception_class: "Error",
        fallback: false,
    });
    assert.ok(logs.some((event) => event.event === "nightly_legacy_client_fallback_served"));
    assert.ok(logs.some((event) => event.event === "nightly_legacy_release_fallback_served"));
    assert.deepEqual(objects, [value.pointer.manifest.key, "nightly/release.json", "nightly/client.json", value.pointer.manifest.key, "nightly/release.json", "nightly/client.json"]);
});

test("client fallback accepts the producer's null baseSha legacy shape", async () => {
    const gateway = CANONICAL_GATEWAY_ORIGIN;
    const legacy = {
        version: 1,
        releaseDate: "2026-11-04",
        headSha: "a".repeat(40),
        baseSha: null,
        workflowRunId: 42007050452,
        builtAt: "2026-11-05T10:04:43Z",
        client: {
            fileName: "Coop 11-04-2026.7z",
            key: `nightly/clients/${"a".repeat(40)}/${"c".repeat(64)}/Coop.7z`,
            bytes: 10,
            sha256: "c".repeat(64),
            publicUrl: `${gateway}/v1/artifacts/nightly/clients/${"a".repeat(40)}/${"c".repeat(64)}/Coop.7z`,
        },
    };
    assert.doesNotThrow(() => validateLegacyNightlyClientManifest(legacy, origin));
});

test("client fallback rejects a publicUrl that names another object, carries a query or fragment, or is on a foreign host", () => {
    const key = `nightly/clients/${"a".repeat(40)}/${"c".repeat(64)}/Coop.7z`;
    const manifest = (publicUrl: string) => ({
        version: 1,
        releaseDate: "2026-11-04",
        headSha: "a".repeat(40),
        baseSha: null,
        workflowRunId: 42007050452,
        builtAt: "2026-11-05T10:04:43Z",
        client: { fileName: "Coop 11-04-2026.7z", key, bytes: 10, sha256: "c".repeat(64), publicUrl },
    });
    assert.doesNotThrow(() => validateLegacyNightlyClientManifest(manifest(`${origin}/${key}`), origin));
    for (const publicUrl of [
        `${CANONICAL_GATEWAY_ORIGIN}/v1/artifacts/${key}?x=1`,
        `${CANONICAL_GATEWAY_ORIGIN}/v1/artifacts/${key}#f`,
        `${origin}/nightly/other.7z`,
        `${origin}/v1/artifacts/${key}`,
        `${CANONICAL_GATEWAY_ORIGIN}/${key}`,
        `https://attacker.invalid/v1/artifacts/${key}`,
    ]) {
        assert.throws(() => validateLegacyNightlyClientManifest(manifest(publicUrl), origin), /invalid_legacy_nightly_client_manifest/, publicUrl);
    }
});

test("the client route requires the complete publication while release keeps the legacy default", async () => {
    const value = fixture();
    const gateway = "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev";
    const legacyRelease = JSON.parse(await readFile(new URL("../fixtures/legacy-release-2026-11-04.json", import.meta.url), "utf8")) as Record<string, unknown>;
    const legacyClient = {
        version: 1,
        releaseDate: legacyRelease.releaseDate,
        headSha: legacyRelease.headSha,
        baseSha: null,
        workflowRunId: 42007050452,
        builtAt: "2026-11-05T10:04:43Z",
        client: legacyRelease.client,
    };
    const legacyReleaseBytes = Buffer.from(JSON.stringify(legacyRelease));
    let legacyClientBytes = Buffer.from(JSON.stringify(legacyClient));
    const object = (bytes: Uint8Array) => ({
        size: bytes.byteLength,
        body: new Response(bytes).body!,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    const env = {
        PUBLIC_RELEASES: {
            async get() {
                return {
                    size: value.pointerBytes.byteLength,
                    body: new Response(value.pointerBytes).body!,
                    arrayBuffer: async () => value.pointerBytes.buffer.slice(value.pointerBytes.byteOffset, value.pointerBytes.byteOffset + value.pointerBytes.byteLength),
                };
            },
        },
        RELEASES: { async get(key: string) {
            if (key === "nightly/client.json") return object(legacyClientBytes);
            if (key === "nightly/release.json") return object(legacyReleaseBytes);
            return value.getObject(key);
        } },
        LEGACY_R2_ORIGIN: origin,
    } as unknown as Env;
    const worker = createGateway({ fetch: value.fetcher, openDatabase: async () => nightlySessionDatabase(), log: noLog });
    const authorization = `Bearer ${"n".repeat(43)}`;
    legacyClientBytes = Buffer.from(JSON.stringify({
        version: 1,
        releaseDate: value.manifest.releaseDate,
        headSha: value.manifest.headSha,
        baseSha: null,
        workflowRunId: Number(value.manifest.clientRunId),
        builtAt: value.manifest.builtAt,
        client: value.manifest.client,
    }));
    const matching = await worker.fetch(new Request(`${gateway}/v1/manifests/client`, {
        headers: { authorization },
    }), env);
    assert.equal(matching.status, 200);
    assert.equal((await matching.json() as { version: number; headSha: string }).version, 1);
    legacyClientBytes = Buffer.from(JSON.stringify(legacyClient));
    for (const path of ["client", "release"]) {
        const response = await worker.fetch(new Request(`${gateway}/v1/manifests/${path}`, {
            headers: { authorization },
        }), env);
        assert.equal(response.status, 200);
        const manifest = await response.json() as { version: number; headSha: string };
        assert.equal(manifest.version, 1);
        assert.equal(manifest.headSha, path === "client" ? value.manifest.headSha : legacyRelease.headSha);
    }
    legacyClientBytes = Buffer.from(JSON.stringify({
        ...legacyClient,
        releaseDate: "2026-11-14",
        headSha: "d".repeat(40),
        client: {
            ...legacyClient.client,
            key: `nightly/clients/${"d".repeat(40)}/${"e".repeat(64)}/Coop.7z`,
            sha256: "e".repeat(64),
            publicUrl: `${gateway}/v1/artifacts/nightly/clients/${"d".repeat(40)}/${"e".repeat(64)}/Coop.7z`,
        },
    }));
    const pairedClient = await worker.fetch(new Request(`${gateway}/v1/manifests/client`, {
        headers: { authorization },
    }), env);
    assert.equal(pairedClient.status, 200);
    assert.equal((await pairedClient.json() as { releaseDate: string }).releaseDate, legacyRelease.releaseDate);
    const v2 = await worker.fetch(new Request(`${gateway}/v1/manifests/release`, {
            headers: { authorization, "x-bannerlord-coop-nightly-version": "2" },
    }), env);
    assert.equal(v2.status, 200);
    assert.equal((await v2.json() as { version: number }).version, 2);
});

test("the headerless client route returns 503 when no complete pair exists", async () => {
    const value = fixture();
    const gateway = "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev";
    const env = {
        PUBLIC_RELEASES: { async get() { return object(value.pointerBytes); } },
        RELEASES: { async get() { return null; } },
        LEGACY_R2_ORIGIN: origin,
    } as unknown as Env;
    const manifestGateway = createGateway({ fetch: value.fetcher, openDatabase: async () => nightlySessionDatabase(), log: noLog });
    const response = await manifestGateway.fetch(new Request(`${gateway}/v1/manifests/client`, {
        headers: { authorization: `Bearer ${"n".repeat(43)}` },
    }), env);
    assert.equal(response.status, 503);
});

test("the client route fails closed when the paired publication is unavailable", async () => {
    const value = fixture();
    const gateway = "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev";
    const env = {
        RELEASES: { async get() { return null; } },
        LEGACY_R2_ORIGIN: origin,
    } as unknown as Env;
    const manifestGateway = createGateway({ fetch: value.fetcher, openDatabase: async () => nightlySessionDatabase(), log: noLog });
    const response = await manifestGateway.fetch(new Request(`${gateway}/v1/manifests/client`, {
        headers: { authorization: `Bearer ${"n".repeat(43)}` },
    }), env);
    assert.equal(response.status, 503);
});

test("v2 client fallback never serves a legacy client ahead of the release pair", async () => {
    const value = fixture();
    const gateway = "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev";
    const legacyRelease = JSON.parse(await readFile(new URL("../fixtures/legacy-release-2026-11-04.json", import.meta.url), "utf8")) as Record<string, unknown>;
    const aheadClient = {
        version: 1, releaseDate: "2026-11-14", headSha: "d".repeat(40), baseSha: null,
        workflowRunId: 99999999999, builtAt: "2026-11-15T00:00:00Z",
        client: { ...(legacyRelease.client as Record<string, unknown>), sha256: "e".repeat(64), key: `nightly/clients/${"d".repeat(40)}/${"e".repeat(64)}/Coop.7z` },
    };
    const bytes = (value: unknown) => {
        const data = Buffer.from(JSON.stringify(value));
        return { size: data.byteLength, body: new Response(data).body!, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
    };
    const env = {
        PUBLIC_RELEASES: { async get() { return bytes(value.pointerBytes); } },
        RELEASES: { async get(key: string) { if (key === value.pointer.manifest.key) return null; if (key === "nightly/release.json") return bytes(legacyRelease); if (key === "nightly/client.json") return bytes(aheadClient); return null; } },
        LEGACY_R2_ORIGIN: origin,
    } as unknown as Env;
    const manifestGateway = createGateway({ fetch: value.fetcher, openDatabase: async () => nightlySessionDatabase(), log: noLog });
    const response = await manifestGateway.fetch(new Request(`${gateway}/v1/manifests/client`, {
        headers: { authorization: `Bearer ${"n".repeat(43)}`, "x-bannerlord-coop-nightly-version": "2" },
    }), env);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { headSha: string }).headSha, legacyRelease.headSha);
});

test("a complete release pair remains available when the legacy client object is missing", async () => {
    const value = fixture();
    const gateway = "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev";
    const legacyRelease = JSON.parse(await readFile(new URL("../fixtures/legacy-release-2026-11-04.json", import.meta.url), "utf8")) as Record<string, unknown>;
    const bytes = (data: Uint8Array) => ({ size: data.byteLength, body: new Response(data).body!, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) });
    const releaseBytes = Buffer.from(JSON.stringify(legacyRelease));
    const env = {
        PUBLIC_RELEASES: { async get() { return null; } },
        RELEASES: { async get(key: string) { return key === "nightly/release.json" ? bytes(releaseBytes) : null; } },
        LEGACY_R2_ORIGIN: origin,
    } as unknown as Env;
    const manifestGateway = createGateway({ fetch: value.fetcher, openDatabase: async () => nightlySessionDatabase(), log: noLog });
    const response = await manifestGateway.fetch(new Request(`${gateway}/v1/manifests/client`, {
        headers: { authorization: `Bearer ${"n".repeat(43)}` },
    }), env);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { headSha: string }).headSha, legacyRelease.headSha);
});

test("accepts the production-shaped legacy release fixture and rejects missing artifact keys", async () => {
    const fixture = JSON.parse(await readFile(new URL("../fixtures/legacy-release-2026-11-04.json", import.meta.url), "utf8")) as Record<string, unknown> & {
        server: { incremental: { base: Record<string, unknown>; update: Record<string, unknown> } };
    };
    assert.doesNotThrow(() => validateLegacyNightlyReleaseManifest(fixture, origin));
    const withoutBaseKey = structuredClone(fixture);
    delete withoutBaseKey.server.incremental.base.key;
    assert.throws(() => validateLegacyNightlyReleaseManifest(withoutBaseKey, origin), /invalid_legacy_nightly_release_artifact/);
    const withoutUpdateKey = structuredClone(withoutBaseKey);
    withoutUpdateKey.server.incremental.base.key = fixture.server.incremental.base.key;
    delete withoutUpdateKey.server.incremental.update.key;
    assert.throws(() => validateLegacyNightlyReleaseManifest(withoutUpdateKey, origin), /invalid_legacy_nightly_release_artifact/);
});

test("gateway rejects a private manifest whose bytes or image digest differ from the public pointer", async () => {
    const value = fixture();
    await assert.rejects(readNightlyPublication(async () => ({
        size: value.bytes.byteLength, body: new Response("changed").body!,
    }), value.fetcher), /checksum_mismatch/);
    value.pointer.container.manifestDigest = `sha256:${"8".repeat(64)}`;
    value.pointer.container.digestReference = `${repository}@${value.pointer.container.manifestDigest}`;
    await assert.rejects(readNightlyPublication(value.getObject, value.fetcher), /container_mismatch/);
});

test("classifies a pointer fetch TypeError before any R2 read", async () => {
    await assert.rejects(
        readNightlyPublication(async () => { throw new Error("R2 must not be read"); }, async () => {
            throw new TypeError("fetch failed");
        }),
        (error: unknown) => {
            assert.ok(error instanceof NightlyPublicationReadError);
            assert.equal(error.stage, "pointer");
            assert.equal(error.status, null);
            assert.equal(error.exceptionClass, "TypeError");
            return true;
        },
    );
});

test("gateway rejects missing, legacy, or secret-bearing pointers without reading private objects", async () => {
    const value = fixture();
    for (const response of [
        new Response(null, { status: 404 }),
        Response.json(value.manifest),
        Response.json({ ...value.pointer, client: value.manifest.client }),
    ]) {
        await assert.rejects(readNightlyPublication(value.getObject, async () => response));
    }
    assert.deepEqual(value.objects, []);
});

test("gateway rejects wrong repositories, tags, uppercase hashes, and extra path segments", () => {
    const value = fixture();
    for (const mutate of [
        (pointer: typeof value.pointer) => { pointer.container.repository = "ghcr.io/attacker/repository"; },
        (pointer: typeof value.pointer) => { pointer.container.digestReference = `${repository}:nightly`; },
        (pointer: typeof value.pointer) => { pointer.container.manifestDigest = `sha256:${"A".repeat(64)}`; },
        (pointer: typeof value.pointer) => { pointer.manifest.key += "/extra"; },
        (pointer: typeof value.pointer) => { pointer.manifest.sha256 = "1".repeat(64); },
    ]) {
        const pointer = structuredClone(value.pointer);
        mutate(pointer);
        assert.throws(() => validateNightlyPublicationPointer(pointer));
    }
});

test("gateway caps both streamed pointer and private manifest bytes", async () => {
    const value = fixture();
    let cancelled = false;
    const oversized = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(4097)); },
        cancel() { cancelled = true; },
    });
    await assert.rejects(readNightlyPublication(value.getObject, async () => new Response(oversized)), /too_large/);
    assert.equal(cancelled, true);
    assert.deepEqual(value.objects, []);
    await assert.rejects(readNightlyPublication(async () => ({
        size: 131073, body: new Response(value.bytes).body!,
    }), value.fetcher), /manifest_unavailable/);
    await assert.rejects(readNightlyPublication(async () => ({
        size: 10, body: new Response(new Uint8Array(131073)).body!,
    }), value.fetcher), /too_large/);
});

test("gateway bounds stalled public fetches and private reads to five seconds", async (context) => {
    const value = fixture();
    let deadline = new AbortController();
    context.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
        assert.equal(milliseconds, 5000);
        return deadline.signal;
    });
    await assert.rejects(readNightlyPublication(value.getObject, async (_url, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => { reject(new Error("public fetch timed out")); }, { once: true });
        deadline.abort();
    })), /timed out/);
    deadline = new AbortController();
    await assert.rejects(readNightlyPublication(async () => {
        queueMicrotask(() => deadline.abort());
        return new Promise(() => {});
    }, value.fetcher), /timeout/);
});

test("manifest artifact URLs follow the gateway host the installer used", async () => {
    const value = fixture();
    const canonical = "https://nightly.bannerlordcoop.com";
    const legacyGateway = "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev";
    const clientKey = value.manifest.client.key;
    // The stored v1 client names the legacy gateway host; it must still validate when served from the new host.
    const storedClient = Buffer.from(JSON.stringify({
        version: 1,
        releaseDate: value.manifest.releaseDate,
        headSha: value.manifest.headSha,
        baseSha: null,
        builtAt: value.manifest.builtAt,
        client: { ...value.manifest.client, publicUrl: `${legacyGateway}/v1/artifacts/${clientKey}` },
    }));
    const env = {
        RELEASES: { async get(key: string) {
            if (key !== "nightly/client.json") return value.getObject(key);
            return {
                size: storedClient.byteLength,
                arrayBuffer: async () => storedClient.buffer.slice(storedClient.byteOffset, storedClient.byteOffset + storedClient.byteLength),
            };
        } },
        LEGACY_R2_ORIGIN: origin,
    } as unknown as Env;
    const manifestGateway = createGateway({ fetch: value.fetcher, openDatabase: async () => nightlySessionDatabase(), log: noLog });
    const authorization = `Bearer ${"n".repeat(43)}`;
    const cases = [
        { host: canonical, expected: canonical },
        { host: legacyGateway, expected: legacyGateway },
        { host: "https://gateway.attacker.invalid", expected: canonical },
    ];
    for (const { host, expected } of cases) {
        const v2 = await manifestGateway.fetch(new Request(`${host}/v1/manifests/release`, {
            headers: { authorization, "x-bannerlord-coop-nightly-version": "2" },
        }), env);
        assert.equal(v2.status, 200);
        const release = await v2.json() as {
            client: { publicUrl: string };
            server: { publicUrl: string; incremental: { base: { publicUrl: string }; update: { publicUrl: string } } };
        };
        assert.equal(release.client.publicUrl, `${expected}/v1/artifacts/${clientKey}`);
        assert.equal(release.server.publicUrl, `${expected}/v1/artifacts/${value.manifest.server.key}`);
        assert.equal(release.server.incremental.base.publicUrl, `${expected}/v1/artifacts/${value.manifest.server.incremental.base.key}`);
        assert.equal(release.server.incremental.update.publicUrl, `${expected}/v1/artifacts/${value.manifest.server.incremental.update.key}`);

        const headerless = await manifestGateway.fetch(new Request(`${host}/v1/manifests/client`, { headers: { authorization } }), env);
        assert.equal(headerless.status, 200);
        const client = await headerless.json() as { version: number; client: { publicUrl: string } };
        assert.equal(client.version, 1);
        assert.equal(client.client.publicUrl, `${expected}/v1/artifacts/${clientKey}`);
    }
});
