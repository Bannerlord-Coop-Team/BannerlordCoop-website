import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { databaseForRequest, postgresSql } from "./database";

test("two Worker isolates race for one global D1 alert claim and retain counts after cooldown", async () => {
    const bundled = await build({
        stdin: { contents: `import { claimDiscordAlert } from "./alerts";
            export default { async fetch(request, env) {
                return Response.json(await claimDiscordAlert(env.LEGACY_DB, "discord_bot_token_rejected"));
            } };`, resolveDir: dirname(fileURLToPath(import.meta.url)) },
        bundle: true, format: "esm", platform: "browser", write: false,
    });
    const runtime = new Miniflare(convertV4MiniflareOptions({ workers: ["first", "second"].map((name) => ({
        name, modules: true, script: bundled.outputFiles[0].text,
        compatibilityDate: "2026-08-13",
        d1Databases: { LEGACY_DB: "11111111-2222-4333-8444-555555555555" },
    })) }));
    try {
        const database = await runtime.getD1Database("LEGACY_DB", "first");
        const migration = readFileSync(new URL("../migrations/0003_discord_alerts.sql", import.meta.url), "utf8");
        await database.prepare(migration).run();
        const [first, second] = await Promise.all([runtime.getWorker("first"), runtime.getWorker("second")]);
        const requests = await Promise.all([first.fetch("https://claim.test"), second.fetch("https://claim.test")]);
        const claims = await Promise.all(requests.map((response) => response.json() as Promise<{
            claimed: boolean; count: number; firstOccurrence: string;
        }>));
        assert.equal(claims.filter((claim) => claim.claimed).length, 1);
        assert.deepEqual(claims.map((claim) => claim.count).sort(), [1, 2]);
        assert.equal(claims[0].firstOccurrence, claims[1].firstOccurrence);
        const suppressed = await (await first.fetch("https://claim.test")).json() as typeof claims[number];
        assert.equal(suppressed.claimed, false);
        assert.equal(suppressed.count, 3);
        // Move the persisted clock back, without waiting an hour in the test.
        await database.prepare("UPDATE discord_alerts SET first_occurrence_at = first_occurrence_at - 3601, last_claimed_at = last_claimed_at - 3601").run();
        const renewed = await (await second.fetch("https://claim.test")).json() as typeof claims[number];
        assert.equal(renewed.claimed, true);
        assert.equal(renewed.count, 4);
        assert.equal(Date.parse(renewed.firstOccurrence), Date.parse(claims[0].firstOccurrence) - 3601_000);
        const afterRenewal = await (await first.fetch("https://claim.test")).json() as typeof claims[number];
        assert.equal(afterRenewal.claimed, false);
        assert.equal(afterRenewal.count, 5);
    } finally {
        await runtime.dispose();
    }
});

test("gateway SQL is schema-qualified and uses PostgreSQL parameters", () => {
    assert.equal(
        postgresSql(
            "SELECT id FROM device_sessions WHERE device_secret_hash = ? AND expires_at >= ?",
            2,
        ),
        "SELECT id FROM \"nightly_gateway\".\"device_sessions\" WHERE device_secret_hash = $1 AND expires_at >= $2",
    );
});

test("INSERT OR IGNORE becomes a conflict-safe PostgreSQL insert", () => {
    assert.equal(
        postgresSql(
            "INSERT OR IGNORE INTO sponsorships (supporter_discord_user_id, sponsored_discord_user_id) VALUES (?, ?)",
            2,
        ),
        "INSERT INTO \"nightly_gateway\".\"sponsorships\" (supporter_discord_user_id, sponsored_discord_user_id) VALUES ($1, $2)\nON CONFLICT DO NOTHING",
    );
});

test("gateway SQL rejects parameter-count drift", () => {
    assert.throws(
        () => postgresSql("SELECT id FROM device_sessions WHERE id = ?", 0),
        /gateway_database_parameter_mismatch/,
    );
});

test("the bridge uses legacy D1 only when it is explicitly selected", async () => {
    const legacy = {
        prepare() { throw new Error("not used"); },
        async batch() { return []; },
    };
    assert.equal(await databaseForRequest({ LEGACY_DB: legacy, DATABASE_BACKEND: "legacy-d1" }), legacy);
});

test("the post-cutover default fails closed without Hyperdrive", async () => {
    await assert.rejects(
        databaseForRequest({}),
        /gateway_database_configuration_invalid/,
    );
});

test("unknown database backends fail closed", async () => {
    await assert.rejects(
        databaseForRequest({ DATABASE_BACKEND: "sqlite" }),
        /gateway_database_backend_invalid/,
    );
});
