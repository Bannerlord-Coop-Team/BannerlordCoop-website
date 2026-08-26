import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const PROJECT_REF = "wfvqnijwuyqjibhlcrhz";
const DATABASE_ROLE = "nightly_gateway_worker";
const HYPERDRIVE_NAME = "bannerlordcoop-nightly-gateway-supabase";
const options = parseArguments(process.argv.slice(2));
if (existsSync(options.connectionStringFile)) throw new Error("Refusing to overwrite the connection-string file.");

const password = randomBytes(32).toString("base64url");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "bannerlordcoop-nightly-role-"));
chmodSync(temporaryDirectory, 0o700);
const sqlPath = join(temporaryDirectory, "provision.sql");

try {
    const passwordLiteral = password.replaceAll("'", "''");
    writeFileSync(sqlPath, [
        "begin;",
        `do $$ begin if exists (select 1 from pg_roles where rolname = '${DATABASE_ROLE}') then`,
        `  alter role ${DATABASE_ROLE} password '${passwordLiteral}';`,
        "else",
        `  create role ${DATABASE_ROLE} login password '${passwordLiteral}' nosuperuser nocreatedb nocreaterole inherit;`,
        "end if; end $$;",
        `grant nightly_gateway_runtime to ${DATABASE_ROLE};`,
        `alter role ${DATABASE_ROLE} set statement_timeout = '5s';`,
        `alter role ${DATABASE_ROLE} set idle_in_transaction_session_timeout = '5s';`,
        "commit;",
        "",
    ].join("\n"), { encoding: "utf8", mode: 0o600, flag: "wx" });
    execFileSync("npx", [
        "--yes", "supabase@2.115.0", "db", "query", "--linked", "--file", sqlPath,
    ], { stdio: ["ignore", "ignore", "inherit"] });

    const hyperdriveOutput = execFileSync("npx", [
        "--yes", "wrangler@4.40.2", "hyperdrive", "create", HYPERDRIVE_NAME,
        "--config", options.wranglerConfig,
        "--origin-host", `db.${PROJECT_REF}.supabase.co`,
        "--origin-port", "5432",
        "--origin-scheme", "postgresql",
        "--database", "postgres",
        "--origin-user", DATABASE_ROLE,
        "--origin-password", password,
        "--sslmode", "require",
        "--caching-disabled",
        "--origin-connection-limit", "5",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const hyperdriveId = hyperdriveOutput.match(/\b[0-9a-f]{32}\b/i)?.[0]
        ?? hyperdriveOutput.match(/\b[0-9a-f]{8}-[0-9a-f-]{27,36}\b/i)?.[0];
    if (hyperdriveId === undefined) throw new Error("Hyperdrive was created but its ID could not be parsed.");

    const poolerUrl = new URL(readFileSync("supabase/.temp/pooler-url", "utf8").trim());
    poolerUrl.username = `${DATABASE_ROLE}.${PROJECT_REF}`;
    poolerUrl.password = password;
    mkdirSync(dirname(options.connectionStringFile), { recursive: true, mode: 0o700 });
    writeFileSync(options.connectionStringFile, `${poolerUrl.href}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    console.log(`hyperdrive_id=${hyperdriveId}`);
    console.log(`owner_only_connection_file=${options.connectionStringFile}`);
} finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
}

function parseArguments(args) {
    const values = {
        connectionStringFile: "",
        wranglerConfig: "nightly-gateway/wrangler.jsonc",
    };
    for (let index = 0; index < args.length; index += 2) {
        const value = args[index + 1];
        if (typeof value !== "string") throw new Error(`Missing value for ${args[index]}.`);
        if (args[index] === "--connection-string-file") values.connectionStringFile = resolve(value);
        else if (args[index] === "--wrangler-config") values.wranglerConfig = value;
        else throw new Error(`Unknown argument: ${args[index]}`);
    }
    if (values.connectionStringFile.length === 0) {
        throw new Error("Usage: npm run gateway:provision-postgres -- --connection-string-file /owner-only/runtime-database-url");
    }
    return values;
}
