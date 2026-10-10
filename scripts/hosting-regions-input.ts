// Prints the `set-hosting-regions` request envelope that publishes the website's hosting-region catalog to the control plane.
// Usage: npx tsx scripts/hosting-regions-input.ts <expectedRevision> "<reason>"   (see docs/server-onboarding.md)
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hostingRegionCatalogPayload } from "../supabase/functions/_shared/hosting-regions";

/** The complete relay envelope: a fresh request ID and the website catalog as the operation's `regions`. */
export function publishEnvelope(args: readonly string[], requestId: string = crypto.randomUUID()) {
    const { expectedRevision, reason } = parseArguments(args);
    return { version: 1, requestId, operation: "set-hosting-regions", input: { expectedRevision, regions: hostingRegionCatalogPayload(), reason } };
}

/** Validates exactly two arguments: a decimal revision of at least 1 and a 3–1000 character reason. */
export function parseArguments(args: readonly string[]): { expectedRevision: number; reason: string } {
    if (args.length !== 2) throw new UsageError("Exactly two arguments are expected; quote a reason that contains spaces.");
    const [revisionText, reason] = args as [string, string];
    if (!/^\d+$/u.test(revisionText) || !Number.isSafeInteger(Number(revisionText)) || Number(revisionText) < 1) {
        throw new UsageError("expectedRevision must be the positive decimal revision that `hosting-regions` currently returns.");
    }
    if (reason.length < 3 || reason.length > 1000) throw new UsageError("reason must be 3–1000 characters.");
    return { expectedRevision: Number(revisionText), reason };
}

/** An argument problem, reported with the usage line. */
export class UsageError extends Error {}

/** Prints the envelope, or the usage line and the problem with a failing exit status. */
function main() {
    try {
        console.log(JSON.stringify(publishEnvelope(process.argv.slice(2)), null, 2));
    } catch (error) {
        if (!(error instanceof UsageError)) throw error;
        console.error(`Usage: npx tsx scripts/hosting-regions-input.ts <expectedRevision> "<reason>"\n${error.message}`);
        process.exitCode = 1;
    }
}

/** Whether this module is the script Node was started with, comparing real paths so junctions and symlinks do not matter. */
function isEntryPoint(): boolean {
    if (process.argv[1] === undefined) return false;
    try {
        return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
}

if (isEntryPoint()) main();
