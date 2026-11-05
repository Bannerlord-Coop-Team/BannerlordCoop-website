import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ABOVE_OLD_LIMIT = 8388609;

// Constraint definitions as 202608260004 and 202609020001 created them.
const NIGHTLY_GATEWAY_TABLE = `create schema nightly_gateway;
    create table nightly_gateway.installer_pins (
        token_hash text primary key,
        client_bytes integer not null,
        server_bytes bigint not null,
        constraint installer_pins_client_bytes check (client_bytes between 1 and 8388608),
        constraint installer_pins_server_bytes check (server_bytes between 1 and 6442450944)
    );
    insert into nightly_gateway.installer_pins values ('existing', 7000000, 4000000000);`;
const CONTROL_PLANE_TABLE = `create schema control_plane;
    create table control_plane.release_builds (
        build_id text primary key,
        client_artifact_byte_size bigint,
        constraint release_builds_client_artifact_byte_size_check check (
            client_artifact_byte_size is null or client_artifact_byte_size between 1 and 8388608
        )
    );
    insert into control_plane.release_builds values ('existing', 7000000), ('archive', null);`;

/** Reads the migration under test. */
function migration(): Promise<string> {
    return readFile("supabase/migrations/20261105200000_remove_client_archive_size_limit.sql", "utf8");
}

/** Asserts a statement fails on a check constraint, which is SQLSTATE 23514. */
async function assertCheckViolation(db: PGlite, sql: string): Promise<void> {
    await assert.rejects(db.exec(sql), (error: { code?: string }) => error.code === "23514");
}

test("migration removes both client upper bounds and keeps the lower bounds", async () => {
    const db = new PGlite();
    try {
        await db.exec(`${NIGHTLY_GATEWAY_TABLE}${CONTROL_PLANE_TABLE}`);
        const sql = await migration();
        await db.exec(sql);
        await db.exec(sql);

        await db.exec(`insert into nightly_gateway.installer_pins values ('large', ${ABOVE_OLD_LIMIT}, 1);
            insert into control_plane.release_builds values ('large', ${ABOVE_OLD_LIMIT}), ('null', null);`);
        await assertCheckViolation(db, "insert into nightly_gateway.installer_pins values ('zero', 0, 1)");
        await assertCheckViolation(db, "insert into control_plane.release_builds values ('zero', 0)");
        // Server limits on the same table are not part of this change.
        await assertCheckViolation(db, "insert into nightly_gateway.installer_pins values ('server', 1, 6442450945)");

        assert.deepEqual((await db.query("select count(*)::integer as total from nightly_gateway.installer_pins")).rows, [{ total: 2 }]);
        assert.deepEqual((await db.query("select count(*)::integer as total from control_plane.release_builds")).rows, [{ total: 4 }]);
    } finally { await db.close(); }
});

test("migration applies when a mirroring repo has no gateway schema", async () => {
    const db = new PGlite();
    try {
        await db.exec(CONTROL_PLANE_TABLE);
        await db.exec(await migration());
        await db.exec(`insert into control_plane.release_builds values ('large', ${ABOVE_OLD_LIMIT})`);
        assert.deepEqual((await db.query("select to_regclass('nightly_gateway.installer_pins') as pins")).rows, [{ pins: null }]);
    } finally { await db.close(); }
});
