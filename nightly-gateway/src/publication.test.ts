import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { validateLegacyNightlyClientManifest, validateNightlyPublicationPointer } from "./core";
import { NIGHTLY_POINTER_URL, readNightlyPublication } from "./publication";
import worker from "./index";

const origin = "https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev";
const repository = "ghcr.io/bannerlord-coop-team/bannerlord-coop-dedicated-server";

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
    return { manifest, bytes, pointer, requests, objects, fetcher, getObject };
}

test("gateway reads the exact public pointer and its hash-bound private object", async () => {
    const value = fixture();
    assert.deepEqual(await readNightlyPublication(value.getObject, value.fetcher), value.manifest);
    assert.equal(NIGHTLY_POINTER_URL, `${origin}/nightly/release.json`);
    assert.equal(value.requests.length, 1);
    assert.equal(value.requests[0].url, `${origin}/nightly/release.json`);
    assert.deepEqual(value.requests[0].options, {
        method: "GET", redirect: "error", signal: value.requests[0].options?.signal,
        headers: { "Cache-Control": "no-cache" },
    });
    assert.ok(value.requests[0].options?.signal instanceof AbortSignal);
    assert.deepEqual(value.objects, [value.pointer.manifest.key]);
    assert.deepEqual(Object.keys(value.pointer).sort(), ["container", "kind", "manifest", "version"]);
});

test("both authenticated manifest routes select the same pointer and keep private JSON inaccessible", async (context) => {
    const value = fixture();
    const gateway = "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev";
    const env = {
        DB: {
            async batch() { throw new Error("manifest discovery must be read-only"); },
            prepare(sql: string) {
                return { bind() {
                    return { async first() {
                        return sql.includes("FROM download_sessions") ? { expires_at: Math.floor(Date.now() / 1000) + 60 } : null;
                    } };
                } };
            },
        },
        RELEASES: { get: value.getObject },
        PUBLIC_ORIGIN: gateway, LEGACY_R2_ORIGIN: origin,
        DISCORD_CLIENT_ID: "1537575576745803799", DISCORD_CLIENT_SECRET: "s".repeat(32),
        DISCORD_BOT_TOKEN: "B".repeat(59), TOKEN_ENCRYPTION_KEY: "A".repeat(43),
    } as unknown as Env;
    context.mock.method(globalThis, "fetch", value.fetcher);
    const headers = { authorization: `Bearer ${"n".repeat(43)}` };
    for (const path of ["client", "release"]) {
        const response = await worker.fetch(new Request(`${gateway}/v1/manifests/${path}`, { headers }), env);
        assert.equal(response.status, 200);
        const manifest = await response.json() as { version: number; client: { publicUrl: string } };
        assert.equal(manifest.version, 2);
        assert.equal(manifest.client.publicUrl, `${gateway}/v1/artifacts/${value.manifest.client.key}`);
    }
    assert.deepEqual(value.objects, [value.pointer.manifest.key, value.pointer.manifest.key]);
    assert.deepEqual(value.requests.map(({ url }) => url), [NIGHTLY_POINTER_URL, NIGHTLY_POINTER_URL]);
    const anonymous = await worker.fetch(new Request(`${gateway}/v1/manifests/release`), env);
    assert.equal(anonymous.status, 401);
    const privateJson = await worker.fetch(new Request(`${gateway}/v1/artifacts/${value.pointer.manifest.key}`, { headers }), env);
    assert.equal(privateJson.status, 400);
    assert.equal(value.requests.length, 2);
});

test("client route falls back to the validated legacy manifest while release stays fail closed", async (context) => {
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
    const legacyBytes = Buffer.from(JSON.stringify(legacy));
    const objects: string[] = [];
    const env = {
        DB: {
            async batch() { throw new Error("manifest discovery must be read-only"); },
            prepare(sql: string) {
                return { bind() {
                    return { async first() {
                        return sql.includes("FROM download_sessions") ? { expires_at: Math.floor(Date.now() / 1000) + 60 } : null;
                    } };
                } };
            },
        },
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
            throw new Error("runtime_binding_read_failed");
        } },
        PUBLIC_ORIGIN: gateway, LEGACY_R2_ORIGIN: origin,
        DISCORD_CLIENT_ID: "1537575576745803799", DISCORD_CLIENT_SECRET: "s".repeat(32),
        DISCORD_BOT_TOKEN: "B".repeat(59), TOKEN_ENCRYPTION_KEY: "A".repeat(43),
    } as unknown as Env;
    const logs: string[] = [];
    context.mock.method(console, "error", (line: string) => logs.push(line));
    context.mock.method(globalThis, "fetch", value.fetcher);
    const headers = { authorization: `Bearer ${"n".repeat(43)}` };
    const client = await worker.fetch(new Request(`${gateway}/v1/manifests/client`, { headers }), env);
    assert.equal(client.status, 200);
    assert.equal((await client.json() as { headSha: string }).headSha, legacy.headSha);
    const release = await worker.fetch(new Request(`${gateway}/v1/manifests/release`, { headers }), env);
    assert.equal(release.status, 503);
    assert.ok(logs.some((line) => line.includes('"event":"nightly_publication_read_failed"')));
    assert.ok(logs.some((line) => line.includes('"event":"nightly_legacy_client_fallback_served"')));
    assert.deepEqual(objects, [value.pointer.manifest.key, "nightly/client.json", value.pointer.manifest.key]);
});

test("client fallback accepts the producer's null baseSha legacy shape", async () => {
    const gateway = "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev";
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
    assert.doesNotThrow(() => validateLegacyNightlyClientManifest(legacy, origin, gateway));
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
