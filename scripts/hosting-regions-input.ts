// Prints the `set-hosting-regions` input that publishes the website's hosting-region catalog to the control plane.
// Usage: npx tsx scripts/hosting-regions-input.ts <expectedRevision> "<reason>"   (see docs/server-onboarding.md)
import { hostingRegionCatalogPayload } from "../supabase/functions/_shared/hosting-regions";

/** Parses the revision and reason arguments, exiting with usage text when either is unusable. */
function parseArguments(args: readonly string[]): { expectedRevision: number; reason: string } {
    const [revisionText, reason] = args;
    const expectedRevision = Number(revisionText);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail("expectedRevision must be the positive integer revision that `hosting-regions` currently returns.");
    if (reason === undefined || reason.length < 3 || reason.length > 1000) fail("reason must be 3–1000 characters.");
    return { expectedRevision, reason };
}

/** Prints the usage line and the problem, then exits unsuccessfully. */
function fail(problem: string): never {
    console.error(`Usage: npx tsx scripts/hosting-regions-input.ts <expectedRevision> "<reason>"\n${problem}`);
    process.exit(1);
}

const { expectedRevision, reason } = parseArguments(process.argv.slice(2));
console.log(JSON.stringify({ expectedRevision, regions: hostingRegionCatalogPayload(), reason }, null, 2));
