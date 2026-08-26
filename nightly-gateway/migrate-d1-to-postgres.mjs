import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";

const TABLES = Object.freeze([
    ["device_sessions", [
        "id", "device_secret_hash", "user_code", "status", "discord_user_id",
        "sponsor_discord_user_id", "oauth_state_hash", "created_at", "expires_at", "authorized_at",
    ]],
    ["supporter_grants", [
        "supporter_discord_user_id", "encrypted_refresh_token", "token_nonce", "sponsor_code_hash", "updated_at",
    ]],
    ["sponsorships", ["supporter_discord_user_id", "sponsored_discord_user_id", "created_at"]],
    ["download_sessions", [
        "token_hash", "device_session_id", "discord_user_id", "supporter_discord_user_id", "created_at", "expires_at",
    ]],
    ["oauth_states", ["state_hash", "purpose", "created_at", "expires_at"]],
    ["sponsor_sessions", ["token_hash", "supporter_discord_user_id", "created_at", "expires_at"]],
    ["installer_pins", [
        "token_hash", "build_id", "client_sha", "server_sha", "client_file_name", "client_bytes",
        "client_sha256", "server_file_name", "server_key", "server_public_url", "server_bytes",
        "server_sha256", "created_at", "expires_at", "consumed_at",
    ]],
    ["pin_download_sessions", ["token_hash", "pin_token_hash", "created_at", "expires_at"]],
]);

const options = parseArguments(process.argv.slice(2));
const connectionString = options.connectionStringStdin
    ? readConnectionStringFromStandardInput()
    : readConnectionStringFile(options.connectionStringFile);
const parsedConnection = new URL(connectionString);
if (!/^postgres(?:ql)?:$/.test(parsedConnection.protocol)
    || !/^nightly_gateway_worker(?:\.|$)/.test(decodeURIComponent(parsedConnection.username))) {
    throw new Error("The connection must use the dedicated nightly_gateway_worker login.");
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), "bannerlordcoop-nightly-gateway-"));
chmodSync(temporaryDirectory, 0o700);
const exportPath = join(temporaryDirectory, "d1-snapshot.sql");
const sqlite = new DatabaseSync(":memory:");
const client = new pg.Client({
    connectionString,
    application_name: "bannerlordcoop-nightly-gateway-migration",
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
    statement_timeout: 15_000,
});
let postgresConnected = false;

try {
    execFileSync("npx", [
        "--yes", "wrangler@4.40.2", "d1", "export", options.databaseName,
        "--remote", "--config", options.wranglerConfig, "--output", exportPath,
    ], { stdio: ["ignore", "ignore", "inherit"] });
    chmodSync(exportPath, 0o600);
    sqlite.exec(readFileSync(exportPath, "utf8"));
    const snapshot = TABLES.map(([table, columns]) => {
        const rows = sqlite.prepare(`select ${columns.map(quoteIdentifier).join(", ")} from ${quoteIdentifier(table)}`).all();
        return { table, columns, rows };
    });

    await client.connect();
    postgresConnected = true;
    await client.query("begin");
    try {
        await client.query(`lock table ${TABLES.map(([table]) => qualifiedTable(table)).join(", ")} in access exclusive mode`);
        for (const { table } of snapshot) {
            const existing = await client.query(`select count(*)::integer as count from ${qualifiedTable(table)}`);
            if (existing.rows[0]?.count !== 0) throw new Error(`Target table ${table} is not empty.`);
        }
        for (const { table, columns, rows } of snapshot) {
            const insertSql = `insert into ${qualifiedTable(table)} (${columns.map(quoteIdentifier).join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")})`;
            for (const row of rows) await client.query(insertSql, columns.map((column) => row[column]));
            const imported = await client.query(`select count(*)::integer as count from ${qualifiedTable(table)}`);
            if (imported.rows[0]?.count !== rows.length) throw new Error(`Count verification failed for ${table}.`);
        }
        await client.query("commit");
    } catch (error) {
        await client.query("rollback");
        throw error;
    }
    for (const { table, rows } of snapshot) console.log(`${table}: ${rows.length} rows imported`);
    console.log("D1 snapshot imported and count-verified in one PostgreSQL transaction.");
} finally {
    if (postgresConnected) await client.end();
    sqlite.close();
    rmSync(temporaryDirectory, { force: true, recursive: true });
}

function parseArguments(args) {
    const values = {
        databaseName: "bannerlordcoop-nightly-access",
        wranglerConfig: "nightly-gateway/wrangler.jsonc",
        connectionStringFile: "",
        connectionStringStdin: false,
    };
    for (let index = 0; index < args.length;) {
        if (args[index] === "--connection-string-stdin") {
            values.connectionStringStdin = true;
            index += 1;
            continue;
        }
        const value = args[index + 1];
        if (typeof value !== "string") throw new Error(`Missing value for ${args[index]}.`);
        if (args[index] === "--connection-string-file") values.connectionStringFile = resolve(value);
        else if (args[index] === "--database-name") values.databaseName = value;
        else if (args[index] === "--wrangler-config") values.wranglerConfig = value;
        else throw new Error(`Unknown argument: ${args[index]}`);
        index += 2;
    }
    if (values.connectionStringStdin === (values.connectionStringFile.length > 0)) {
        throw new Error("Pass exactly one of --connection-string-stdin or --connection-string-file PATH.");
    }
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(values.databaseName)) throw new Error("Invalid D1 database name.");
    return values;
}

function readConnectionStringFile(path) {
    const metadata = statSync(path);
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
        throw new Error("The connection-string file must be a regular owner-only file (mode 0600)." );
    }
    return validateConnectionString(readFileSync(path, "utf8"));
}

function readConnectionStringFromStandardInput() {
    return validateConnectionString(readFileSync(0, "utf8"));
}

function validateConnectionString(input) {
    const value = input.trim();
    if (value.length < 32 || value.length > 8_192 || /[\r\n]/.test(value)) {
        throw new Error("The connection string is invalid.");
    }
    return value;
}

function quoteIdentifier(value) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error("Invalid SQL identifier.");
    return `"${value}"`;
}

function qualifiedTable(table) {
    return `"nightly_gateway".${quoteIdentifier(table)}`;
}
