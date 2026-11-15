import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import { insertDownloadSession } from "../../supabase/functions/_shared/nightly/downloads.ts";
import { DOWNLOAD_SESSION_SECONDS } from "../../supabase/functions/_shared/nightly/policy.ts";
import { cryptoRandomBytes, randomToken, sha256 } from "../../supabase/functions/_shared/nightly/tokens.ts";
import {
    FRIEND,
    SPONSOR,
    seedDevice,
    seedGrant,
    singleConnectionDatabase,
} from "../../supabase/functions/nightly-gateway/test-harness.ts";
import { authorizeDownload } from "./downloads";
import { GatewayError } from "./http";
import { createWorkerSchemaDatabase, workerDatabase } from "./postgres-test-database";

// The download-session handoff: the Edge Function writes nightly_gateway.download_sessions and the Worker reads it.
// Both sides run their real code against the real migrations, so a drift in token format, hashing or columns fails here.

let database: PGlite;

before(async () => {
    database = await createWorkerSchemaDatabase();
    await seedGrant(database, SPONSOR);
});

after(async () => {
    await database.close();
});

// Issues a download session exactly as the Edge Function does: its token generator, its hash, its insert.
// Each session needs its own device session, named by a one-letter suffix.
async function issueEdgeDownloadSession(suffix: string, createdAt: number, expiresAt: number): Promise<string> {
    const device = await seedDevice(database, { suffix, status: "consumed", discordUserId: FRIEND, sponsorId: SPONSOR });
    const accessToken = randomToken(cryptoRandomBytes);
    await insertDownloadSession(singleConnectionDatabase(database), {
        tokenHash: await sha256(accessToken),
        deviceId: device.id,
        userId: FRIEND,
        sponsorId: SPONSOR,
        createdAt,
        expiresAt,
    });
    return accessToken;
}

// Builds an installer manifest request carrying the download token as its bearer.
function bearerRequest(token: string): Request {
    return new Request("https://nightly.bannerlordcoop.com/v1/manifests/client", {
        headers: { authorization: `Bearer ${token}` },
    });
}

// Tells whether a rejection is the Worker's 401 for a missing or lapsed download session.
function isAuthorizationExpired(error: unknown): boolean {
    return error instanceof GatewayError && error.status === 401 && error.code === "authorization_expired";
}

// The Worker reads download sessions on the wall clock, so the Edge rows are issued relative to it.
function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

test("a download session the Edge Function issues authorizes the Worker's nightly downloads", async () => {
    const now = nowSeconds();
    const token = await issueEdgeDownloadSession("A", now, now + DOWNLOAD_SESSION_SECONDS);

    assert.deepEqual(await authorizeDownload(bearerRequest(token), workerDatabase(database)), { kind: "nightly" });
});

test("a token the Edge Function never issued is an expired authorization", async () => {
    const unknown = randomToken(cryptoRandomBytes);

    await assert.rejects(authorizeDownload(bearerRequest(unknown), workerDatabase(database)), isAuthorizationExpired);
});

test("an expired Edge download session is an expired authorization", async () => {
    const now = nowSeconds();
    const token = await issueEdgeDownloadSession("B", now - 2 * DOWNLOAD_SESSION_SECONDS, now - DOWNLOAD_SESSION_SECONDS);

    await assert.rejects(authorizeDownload(bearerRequest(token), workerDatabase(database)), isAuthorizationExpired);
});
