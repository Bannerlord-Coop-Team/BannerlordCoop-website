// Drift checks for the funding-provider registry: the TypeScript registry and snapshot parser against the
// shared cross-repo fixture (same bytes and path as ControlPlane), and the SQL registry against both.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { FUNDING_PROVIDER_GRAMMAR, FUNDING_PROVIDERS, parseFundingSnapshot, type FundingProvider } from "../supabase/functions/_shared/funding-provider";
import { fundingAccountOperation, type FundingAccountOperation } from "../supabase/functions/_shared/funding-account";

const CONTRACT_PATH = "test/fixtures/cross-repo/funding-provider-contract-v1.json";
const CONTRACT_SHA256 = "2038c8a4892896457b5ec53ca526b97d479b4c52757c2a65169d6b7783633366";
const KINDS = { userId: "user", programId: "program", tierId: "tier" } as const;
const history = ["20260907212654_create_patreon_links.sql", "20260907220000_patreon_website_roles.sql", "20260907230000_atomic_live_console_assignments.sql",
    "202609080002_membership_onboarding.sql", "202609080003_membership_role_locking.sql", "20260908030000_patreon_event_reconciliation.sql",
    "20260910200000_membership_receipt_claims.sql", "202609110001_edge_owned_link_commit.sql", "20260919010000_actionable_patreon_retries.sql",
    "202609220001_patreon_allocation_webhooks.sql", "202609280003_account_owned_membership.sql", "202609280006_membership_paid_access_end.sql",
    "202610020001_membership_allocation_usd20.sql", "20261009170000_patreon_creator_token_refresh.sql",
    "20261109140000_membership_funding_providers.sql", "20261110120000_boosty_membership_adapter.sql"];
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

/** Extracts the quoted provider names of one CHECK definition, in order. */
function checkedProviders(definition: string): string[] {
    return [...definition.matchAll(/'([a-z0-9-]+)'::text/gu)].map(match => match[1]);
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
    const db = new PGlite();
    const query = async (sql: string, args: unknown[] = []) => (await db.query<Row>(sql, args)).rows;
    try {
        await db.exec("create schema auth; create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, deleted_at timestamptz, banned_until timestamptz, raw_app_meta_data jsonb default '{}', updated_at timestamptz default now()); create role anon; create role authenticated; create role service_role;");
        for (const name of history) await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));

        // Every CHECK on a public `provider` column: the outbox names every provider, provider heads every non-Patreon one.
        const checks = await query(`select c.conrelid::regclass::text as "table", pg_get_constraintdef(c.oid) as definition from pg_constraint c
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
            where c.contype = 'c' and c.connamespace = 'public'::regnamespace and a.attname = 'provider' and array_length(c.conkey, 1) = 1 order by 1`);
        assert.deepEqual(checks.map(check => check.table), ["membership_outbox", "membership_provider_heads"]);
        for (const check of checks) {
            const expected = check.table === "membership_provider_heads" ? others.map(entry => entry.provider) : [...FUNDING_PROVIDERS];
            assert.deepEqual(checkedProviders(check.definition as string), expected, check.table as string);
        }

        // The single SQL grammar helper has one arm per non-Patreon provider and kind, with the fixture's pattern.
        const helper = (await query("select pg_get_functiondef('public.membership_provider_identifier_valid'::regproc) as body"))[0].body as string;
        const arms = [...helper.matchAll(/when '([a-z0-9-]+):([a-z]+)' then p_value ~ '([^']+)'/gu)].map(([, provider, kind, pattern]) => ({ provider, kind, pattern }));
        assert.deepEqual(arms, others.flatMap(entry => (["userId", "programId", "tierId"] as const).map(field => ({ provider: entry.provider, kind: KINDS[field], pattern: entry[field] }))));
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

        // Each non-Patreon provider has empty evidence in its first policy version and an identity arm; nothing else does.
        for (const entry of others) {
            const empty = (await query("select public.membership_provider_empty_evidence($1) as e", [entry.provider]))[0].e as Row;
            assert.deepEqual([empty.policyVersion, empty.memberId], [entry.policyVersions[0], null]);
        }
        for (const provider of ["patreon", "ko-fi", null]) assert.equal((await query("select public.membership_provider_empty_evidence($1) as e", [provider]))[0].e, null);
        const identity = (await query("select pg_get_functiondef('public.membership_provider_identity'::regproc) as body"))[0].body as string;
        assert.deepEqual([...identity.matchAll(/when '([a-z0-9-]+)' then/gu)].map(match => match[1]), others.map(entry => entry.provider));
        await assert.rejects(query("select public.membership_provider_identity(gen_random_uuid(), 'ko-fi')"), /Invalid funding provider/u);
    } finally { await db.close(); }
});

test("the account-surface registry resolves each provider's own wire operation names and nothing else", () => {
    const named = (label: string): FundingAccountOperation => async () => Response.json({ label });
    const patreonStatus = named("patreon-status"), patreonUnlink = named("patreon-unlink");
    const boostyStatus = named("boosty-status"), boostyStart = named("boosty-start"), boostyUnlink = named("boosty-unlink");
    const surfaces = { patreon: { operationPrefix: "", operations: { status: patreonStatus, unlink: patreonUnlink } },
        boosty: { operationPrefix: "boosty-", operations: { status: boostyStatus, start: boostyStart, unlink: boostyUnlink } } };
    // Patreon keeps its legacy unprefixed names; other providers are prefixed by their id.
    assert.equal(fundingAccountOperation(surfaces, "status"), patreonStatus);
    assert.equal(fundingAccountOperation(surfaces, "unlink"), patreonUnlink);
    assert.equal(fundingAccountOperation(surfaces, "boosty-status"), boostyStatus);
    assert.equal(fundingAccountOperation(surfaces, "boosty-start"), boostyStart);
    assert.equal(fundingAccountOperation(surfaces, "boosty-unlink"), boostyUnlink);
    for (const unknown of ["start", "boosty-link", "ko-fi-status", "Boosty-status", "", null, 1, ["status"]]) assert.equal(fundingAccountOperation(surfaces, unknown), null, String(unknown));
});
