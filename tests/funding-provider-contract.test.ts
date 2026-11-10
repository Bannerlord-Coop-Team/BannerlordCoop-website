// Drift checks for the funding-provider registry: the TypeScript registry and snapshot parser against the
// shared cross-repo fixture (same bytes and path as ControlPlane), and the SQL registry against both.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { FUNDING_PROVIDER_GRAMMAR, FUNDING_PROVIDERS, parseFundingSnapshot, type FundingProvider } from "../supabase/functions/_shared/funding-provider";
import { FUNDING_ACCOUNT_ACTIONS, fundingAccountOperation, fundingAccountOperationName, type FundingAccountOperation } from "../supabase/functions/_shared/funding-account";

const CONTRACT_PATH = "test/fixtures/cross-repo/funding-provider-contract-v1.json";
const CONTRACT_SHA256 = "2038c8a4892896457b5ec53ca526b97d479b4c52757c2a65169d6b7783633366";
const KINDS = { userId: "user", programId: "program", tierId: "tier" } as const;
// Schema the membership chain needs that never names a registry object. Every migration that does name one,
// a non-Patreon provider id or its adapter schema is found by scanning the directory, so a later migration
// re-creating a registry function or altering a provider or identifier CHECK is always replayed (and must
// apply) here; the drift test cannot pass on a stale schema.
const PREREQUISITES = ["20260907212654_create_patreon_links.sql", "20260907220000_patreon_website_roles.sql", "20260907230000_atomic_live_console_assignments.sql",
    "202609080002_membership_onboarding.sql", "202609080003_membership_role_locking.sql", "20260908030000_patreon_event_reconciliation.sql",
    "20260910200000_membership_receipt_claims.sql", "202609110001_edge_owned_link_commit.sql", "20260919010000_actionable_patreon_retries.sql",
    "202609220001_patreon_allocation_webhooks.sql", "202609280003_account_owned_membership.sql", "202609280006_membership_paid_access_end.sql",
    "202610020001_membership_allocation_usd20.sql", "20261009170000_patreon_creator_token_refresh.sql"];
type AdapterProvider = Exclude<FundingProvider, "patreon">;
type IdentifierColumn = { table: string; column: string; kind: "user" | "program" | "tier" };
// Each non-Patreon provider's adapter: its schema, the identifier columns it stores, its current-link lookup
// (the identity function's branch) and the policy version of its empty evidence. A missing provider fails to compile.
const ADAPTERS: Record<AdapterProvider, { schema: string; identifiers: IdentifierColumn[]; identity: string; emptyPolicyVersion: string }> = {
    boosty: { schema: "boosty_membership", identity: "select boosty_user_id from boosty_membership.links where account_id=p_account_id", emptyPolicyVersion: "boosty-paid-v1", identifiers: [
        { table: "boosty_membership.links", column: "boosty_user_id", kind: "user" },
        { table: "boosty_membership.absences", column: "boosty_user_id", kind: "user" },
        { table: "boosty_membership.sync_state", column: "blog", kind: "program" },
    ] },
};
const ADAPTER_PROVIDERS = FUNDING_PROVIDERS.filter((provider): provider is AdapterProvider => provider !== "patreon");
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** Quotes a fixture or adapter value as a SQL string literal, refusing a quote instead of escaping it. */
function sqlLiteral(value: string): string {
    assert.ok(!value.includes("'") && !value.includes("\\"), `unexpected quote or backslash in ${value}`);
    return `'${value}'`;
}

/** Every object whose later redefinition must be replayed: each checked function, the provider tables, the
 * prefix of every registry helper, and each non-Patreon provider id and adapter schema. Patreon's own name is
 * left out: it appears throughout its historical tables, which keep their own CHECKs outside this registry. */
function registryObjects(contract: { providers: ContractProvider[] }): RegExp {
    const functions = Object.keys(registryFunctions(contract)).map(signature => /^public\.([a-z_]+)\(/u.exec(signature)![1]);
    const names = [...functions, "membership_provider_heads", "membership_outbox", ...ADAPTER_PROVIDERS.flatMap(provider => [provider, ADAPTERS[provider].schema])];
    return new RegExp(`membership_provider_|${names.map(name => `\\b${escape(name)}\\b`).join("|")}`, "u");
}
type Identifiers = { userId: string; programId: string; tierId: string; memberId: string | null };
type ContractProvider = { provider: FundingProvider; userId: string; programId: string; tierId: string; memberResource: "uuid" | "none"; policyVersions: string[]; valid: Identifiers; invalid: Identifiers };
type Row = Record<string, unknown>;

/** Reads the shared fixture bytes and parsed document. */
async function readContract() {
    const bytes = await readFile(CONTRACT_PATH);
    return { bytes, contract: JSON.parse(bytes.toString("utf8")) as { fixtureVersion: number; regexFlags: string; providers: ContractProvider[] } };
}

/** A linked version 2 snapshot for one provider, built from fixture identifiers. */
function snapshot(entry: ContractProvider, ids: Identifiers) {
    return { version: 2, provider: entry.provider, accountId: "10000000-0000-4000-8000-000000000001", discordUserId: null, providerUserId: ids.userId,
        linkGeneration: "1", revision: "1", linkState: "linked", verification: "qualifying", programId: ids.programId, memberId: ids.memberId,
        tierIds: [ids.tierId], verifiedAt: "2026-11-10T12:00:00.000Z", paidThroughAt: null, policyVersion: entry.policyVersions[0], evidenceSha256: "a".repeat(64) };
}

/** Lists, in apply (filename) order, the prerequisites plus every migration naming a registry object. */
async function replayedMigrations(contract: { providers: ContractProvider[] }): Promise<string[]> {
    const objects = registryObjects(contract);
    const all = (await readdir("supabase/migrations")).filter(name => name.endsWith(".sql")).sort();
    for (const name of PREREQUISITES) assert.ok(all.includes(name), `missing prerequisite ${name}`);
    const replayed: string[] = [];
    for (const name of all) {
        if (PREREQUISITES.includes(name) || objects.test(await readFile(`supabase/migrations/${name}`, "utf8"))) replayed.push(name);
    }
    assert.ok(replayed.includes("20261109140000_membership_funding_providers.sql") && replayed.includes("20261110120000_boosty_membership_adapter.sql"));
    return replayed;
}

/** Collapses whitespace so a function body compares independently of its layout. */
function normalized(body: string): string {
    return body.replace(/\s+/gu, " ").trim();
}

type FunctionSpec = { language: "sql" | "plpgsql"; volatility: "i" | "s" | "v"; securityDefiner: boolean; execute: "none" | "service_role"; body: { exact: string } | { sha256: string } };

/** The exact definition and privileges of every SQL registry and fence function. Registry bodies are generated
 * from the fixture and ADAPTERS; the provider-neutral machinery is pinned by its normalized body digest. */
function registryFunctions(contract: { providers: ContractProvider[] }): Record<string, FunctionSpec> {
    const others = contract.providers.filter(entry => entry.provider !== "patreon");
    const fields = ["userId", "programId", "tierId"] as const;
    const empty = (version: string) => JSON.stringify({ verification: "unverified", programId: null, memberId: null, tierIds: [], verifiedAt: null, paidThroughAt: null, policyVersion: version, evidenceSha256: null });
    const registry = (body: string, language: "sql" | "plpgsql" = "sql", volatility: "i" | "s" = "i", securityDefiner = false): FunctionSpec => ({ language, volatility, securityDefiner, execute: "none", body: { exact: body } });
    const pinned = (sha256: string, execute: "none" | "service_role", language: "sql" | "plpgsql" = "plpgsql", volatility: "s" | "v" = "v", securityDefiner = true): FunctionSpec => ({ language, volatility, securityDefiner, execute, body: { sha256 } });
    return {
        "public.membership_provider_identifier_valid(text,text,text)": registry(`select case p_provider || ':' || p_kind ${others.flatMap(entry => fields.map(field => `when ${sqlLiteral(`${entry.provider}:${KINDS[field]}`)} then p_value ~ ${sqlLiteral(entry[field])}`)).join(" ")} else false end`),
        "public.membership_provider_policy_versions(text)": registry(`select case p_provider ${others.map(entry => `when ${sqlLiteral(entry.provider)} then array[${entry.policyVersions.map(sqlLiteral).join(",")}]`).join(" ")} end`),
        "public.membership_provider_empty_evidence(text)": registry(`select case p_provider ${others.map(entry => `when ${sqlLiteral(entry.provider)} then ${sqlLiteral(empty(ADAPTERS[entry.provider as AdapterProvider].emptyPolicyVersion))}::jsonb`).join(" ")} end`),
        "public.membership_provider_identity(uuid,text)": registry(`begin case p_provider ${others.map(entry => `when ${sqlLiteral(entry.provider)} then return (${ADAPTERS[entry.provider as AdapterProvider].identity});`).join(" ")} else raise exception 'Invalid funding provider'; end case; end`, "plpgsql", "s", true),
        "public.membership_provider_snapshot_json(membership_provider_heads)": pinned("d990d1b1932af11f34c4563f771550a7ad6408c81014e9ebb5264fe894c646eb", "none", "sql", "s", false),
        "public.membership_notify_provider(uuid,text,boolean)": pinned("9f71c677e931612350e79b9cc7f11daf2997681065ca43f1208ca5645100c9cf", "none"),
        "public.membership_provider_fence(uuid,text,text,boolean)": pinned("7c33a93d542223a71fd16d93970e6c76484a0f2d7a4aa2ead42ef1658df7005b", "none"),
        "public.membership_auth_deleted()": pinned("3105eabcbaf09d6f3c6555a9a44282a8ba0732a8b8a9db45e463258a26961222", "none"),
        "public.membership_notify(uuid,boolean)": pinned("698104ca0e895ea054902f9ffa69fe805e090909bbcc83da787f2d272bb600fe", "none"),
        "public.membership_funding_fence(uuid,text,text,boolean)": pinned("bc7d35a7993a291802e00b8a077913953df21fbe3371e1d259e795f7c0a0978e", "service_role"),
        "public.membership_funding_claim(uuid,integer)": pinned("f3f8a493926b2e4c35b89498b80552dfa378ffd1cf19a657319546a7e3087400", "service_role"),
        "public.membership_ack(uuid,uuid)": pinned("b2168f23f83d15923e1a60a33bd2f74ba3d5ac174abb439181a8287b586a63cc", "service_role"),
        "public.membership_ack_claim(uuid,uuid,uuid)": pinned("88e926905f20dd1743bf7bd96b5d08e36837f00effd1f146153cfc0efd053649", "service_role"),
    };
}

/** The exact definition PostgreSQL reports for `provider in (...)` over these providers. */
function providerCheck(providers: readonly string[]): string {
    const literals = providers.map(provider => `${sqlLiteral(provider)}::text`);
    return literals.length === 1 ? `CHECK ((provider = ${literals[0]}))` : `CHECK ((provider = ANY (ARRAY[${literals.join(", ")}])))`;
}

test("the TypeScript registry and snapshot parser match the shared provider contract", async () => {
    const { bytes, contract } = await readContract();
    assert.equal(createHash("sha256").update(bytes).digest("hex"), CONTRACT_SHA256, "the fixture bytes equal ControlPlane's copy");
    assert.equal(contract.fixtureVersion, 1);
    assert.deepEqual(contract.providers.map(entry => entry.provider), [...FUNDING_PROVIDERS]);
    for (const entry of contract.providers) {
        const grammar = FUNDING_PROVIDER_GRAMMAR[entry.provider];
        for (const field of ["userId", "programId", "tierId"] as const) {
            assert.equal(grammar[field].source, entry[field], `${entry.provider}.${field}`);
            assert.equal(grammar[field].flags, contract.regexFlags, `${entry.provider}.${field}`);
        }
        assert.equal(grammar.memberResource, entry.memberResource);
        assert.deepEqual([...grammar.policyVersions], entry.policyVersions);
        const accepted = parseFundingSnapshot(snapshot(entry, entry.valid), "10000000-0000-4000-8000-000000000001", entry.provider);
        assert.equal(accepted.memberId, entry.valid.memberId);
        for (const field of ["userId", "programId", "tierId", "memberId"] as const) {
            assert.throws(() => parseFundingSnapshot(snapshot(entry, { ...entry.valid, [field]: entry.invalid[field] }), "10000000-0000-4000-8000-000000000001", entry.provider), `${entry.provider}.${field}`);
        }
    }
});

test("the SQL provider registry matches the TypeScript provider list and the shared contract", async () => {
    const { contract } = await readContract();
    const others = contract.providers.filter(entry => entry.provider !== "patreon");
    // Generated SQL never splices a quote or backslash from the fixture into a literal.
    for (const unsafe of ["^a'b$", "^\\d$"]) assert.throws(() => sqlLiteral(unsafe), /unexpected quote or backslash/u);
    const db = new PGlite();
    const query = async (sql: string, args: unknown[] = []) => (await db.query<Row>(sql, args)).rows;
    try {
        await db.exec("create schema auth; create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, deleted_at timestamptz, banned_until timestamptz, raw_app_meta_data jsonb default '{}', updated_at timestamptz default now()); create role anon; create role authenticated; create role service_role;");
        for (const name of await replayedMigrations(contract)) await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));

        // Every CHECK on a public `provider` column: the outbox names every provider, provider heads every non-Patreon one.
        const checks = await query(`select c.conrelid::regclass::text as "table", pg_get_constraintdef(c.oid) as definition from pg_constraint c
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
            where c.contype = 'c' and c.connamespace = 'public'::regnamespace and a.attname = 'provider' and array_length(c.conkey, 1) = 1 order by 1`);
        assert.deepEqual(checks.map(check => check.table), ["membership_outbox", "membership_provider_heads"]);
        for (const check of checks) {
            const expected = check.table === "membership_provider_heads" ? others.map(entry => entry.provider) : [...FUNDING_PROVIDERS];
            assert.equal(check.definition, providerCheck(expected), check.table as string);
        }

        // Storage-level identifier CHECKs: exactly the expected set, each calling the helper, and no other CHECK
        // (such as a raw `~` pattern) on any identifier column, so SQL never admits an id the parsers reject.
        const schemas = ["public", ...ADAPTER_PROVIDERS.map(provider => ADAPTERS[provider].schema)];
        const expected = [{ table: "membership_provider_heads", column: "provider_user_id", definition: "CHECK (membership_provider_identifier_valid(provider, 'user'::text, provider_user_id))" },
            ...ADAPTER_PROVIDERS.flatMap(provider => ADAPTERS[provider].identifiers.map(({ table, column, kind }) =>
                ({ table, column, definition: `CHECK (membership_provider_identifier_valid(${sqlLiteral(provider)}::text, ${sqlLiteral(kind)}::text, ${column}))` })))];
        const definitions = async (where: string, args: unknown[]) => (await query(`select c.conrelid::regclass::text as "table", replace(pg_get_constraintdef(c.oid), 'public.', '') as definition
            from pg_constraint c where c.contype = 'c' and c.connamespace = any(select oid from pg_namespace where nspname = any($1::text[])) and ${where} order by 1, 2`, [schemas, ...args]))
            .map(row => ({ table: row.table as string, definition: row.definition as string }));
        assert.deepEqual(await definitions("pg_get_constraintdef(c.oid) like '%membership_provider_identifier_valid%'", []),
            expected.map(({ table, definition }) => ({ table, definition })).sort((a, b) => a.table < b.table ? -1 : a.table > b.table ? 1 : a.definition < b.definition ? -1 : 1));
        for (const { table, column, definition } of expected) {
            const onColumn = await definitions("c.conrelid = $2::regclass and exists(select 1 from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any(c.conkey) and a.attname = $3)", [table, column]);
            assert.deepEqual(onColumn, [{ table, definition }], `${table}.${column} is checked only by the identifier helper`);
        }

        // Every registry and fence function has exactly its expected body, language, volatility, definer, search
        // path and EXECUTE grants (a dropped and re-created function would regain PUBLIC EXECUTE); there are no others.
        const specs = registryFunctions(contract);
        const registered = await query(`select p.oid::regprocedure::text as signature from pg_proc p where p.pronamespace = 'public'::regnamespace
            and (p.proname like 'membership\\_provider\\_%' or p.proname in ('membership_notify_provider', 'membership_funding_fence', 'membership_funding_claim')) order by 1`);
        assert.deepEqual(registered.map(row => `public.${row.signature as string}`), Object.keys(specs).filter(signature => /membership_provider_|membership_notify_provider|membership_funding_/u.test(signature)).sort());
        for (const [signature, spec] of Object.entries(specs)) {
            const [row] = await query(`select l.lanname as language, p.provolatile as volatility, p.prosecdef as "securityDefiner", p.proconfig as config, p.prosrc as body,
                has_function_privilege('public', p.oid, 'execute') as public, has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as authenticated, has_function_privilege('service_role', p.oid, 'execute') as service_role
                from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = $1::regprocedure`, [signature]);
            assert.deepEqual([row.language, row.volatility, row.securityDefiner, row.config], [spec.language, spec.volatility, spec.securityDefiner, ['search_path=""']], signature);
            const body = normalized(row.body as string);
            if ("exact" in spec.body) assert.equal(body, spec.body.exact, signature);
            else assert.equal(createHash("sha256").update(body).digest("hex"), spec.body.sha256, `${signature} changed; review it, then update its pinned digest`);
            assert.deepEqual({ public: row.public, anon: row.anon, authenticated: row.authenticated, service_role: row.service_role },
                { public: false, anon: false, authenticated: false, service_role: spec.execute === "service_role" }, `${signature} grants`);
        }
        const valid = async (provider: string, kind: string, value: string | null) => (await query("select public.membership_provider_identifier_valid($1,$2,$3) as ok", [provider, kind, value]))[0].ok;
        for (const entry of contract.providers) {
            for (const field of ["userId", "programId", "tierId"] as const) {
                // Patreon keeps its own historical tables, so the helper never admits a Patreon identifier.
                assert.equal(await valid(entry.provider, KINDS[field], entry.valid[field]), entry.provider !== "patreon", `${entry.provider}.${field}`);
                assert.equal(await valid(entry.provider, KINDS[field], entry.invalid[field]), false, `${entry.provider}.${field} invalid`);
            }
        }
        assert.equal(await valid("boosty", "member", "1"), false);
        assert.equal(await valid("boosty", "user", null), null, "a null identifier stays nullable");

        // Each non-Patreon provider accepts exactly the fixture's policy versions and has empty evidence in one of them;
        // nothing else does.
        for (const entry of others) {
            assert.deepEqual((await query("select public.membership_provider_policy_versions($1) as v", [entry.provider]))[0].v, entry.policyVersions);
            const empty = (await query("select public.membership_provider_empty_evidence($1) as e", [entry.provider]))[0].e as Row;
            assert.ok(entry.policyVersions.includes(empty.policyVersion as string), entry.provider);
            assert.equal(empty.memberId, null);
        }
        for (const provider of ["patreon", "ko-fi", null]) {
            assert.equal((await query("select public.membership_provider_empty_evidence($1) as e", [provider]))[0].e, null);
            assert.equal((await query("select public.membership_provider_policy_versions($1) as v", [provider]))[0].v, null);
        }
        await assert.rejects(query("select public.membership_provider_identity(gen_random_uuid(), 'ko-fi')"), /Invalid funding provider/u);
    } finally { await db.close(); }
});

test("the account-surface registry resolves each provider's own wire operation names and nothing else", () => {
    const named = (label: string): FundingAccountOperation => async () => Response.json({ label });
    const patreonStatus = named("patreon-status"), patreonUnlink = named("patreon-unlink");
    const boostyStatus = named("boosty-status"), boostyStart = named("boosty-start"), boostyUnlink = named("boosty-unlink");
    const surfaces = { patreon: { operations: { status: patreonStatus, unlink: patreonUnlink } },
        boosty: { operations: { status: boostyStatus, start: boostyStart, unlink: boostyUnlink } } };
    // Derived names are unique across every provider and action, so no provider can shadow another's operation.
    const names = FUNDING_PROVIDERS.flatMap(provider => FUNDING_ACCOUNT_ACTIONS.map(action => fundingAccountOperationName(provider, action)));
    assert.equal(new Set(names).size, names.length);
    assert.ok(names.every(name => !name.startsWith("discord-")), "funding names never collide with Discord linking");
    // Patreon keeps its legacy unprefixed names; other providers are prefixed by their id.
    assert.equal(fundingAccountOperation(surfaces, "status"), patreonStatus);
    assert.equal(fundingAccountOperation(surfaces, "unlink"), patreonUnlink);
    assert.equal(fundingAccountOperation(surfaces, "boosty-status"), boostyStatus);
    assert.equal(fundingAccountOperation(surfaces, "boosty-start"), boostyStart);
    assert.equal(fundingAccountOperation(surfaces, "boosty-unlink"), boostyUnlink);
    for (const unknown of ["start", "boosty-link", "ko-fi-status", "Boosty-status", "", null, 1, ["status"]]) assert.equal(fundingAccountOperation(surfaces, unknown), null, String(unknown));
});
