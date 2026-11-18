import "server-only";

import { getSupabaseAdminClient } from "@/app/lib/supabase/admin";
import type { ReleaseBuild } from "./types";

const RELEASE_OBSERVATION_BATCH_SIZE = 100;
const MAXIMUM_RELEASE_OBSERVATION_BATCHES = 10;

export type ReleaseObservationResult = ReleaseBuild[] & { partial: boolean };

function withPartial(builds: ReleaseBuild[], partial: boolean): ReleaseObservationResult {
    Object.defineProperty(builds, "partial", { value: partial, enumerable: false });
    return builds as ReleaseObservationResult;
}

/** Retains display timestamps independently of fresh release selection and channel aliases. */
export async function recordReleaseFirstObservations(builds: readonly ReleaseBuild[], signal?: AbortSignal): Promise<ReleaseObservationResult> {
    const identities = new Map<string, string>();
    for (const build of builds) {
        if (!build.registryMetadata) continue;
        const digest = build.container?.manifestDigest;
        if (!digest || !/^sha256:[a-f0-9]{64}$/u.test(digest)
            || !["stable", "nightly"].includes(build.channel)) {
            throw new Error("Invalid release observation identity.");
        }
        identities.set(build.buildId, `${build.channel}-${digest.slice(7)}`);
    }
    if (identities.size === 0) return withPartial([...builds], false);

    const client = getSupabaseAdminClient();
    const deadline = AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]);
    const ids = [...new Set(identities.values())];
    const boundedIds = ids.slice(0, RELEASE_OBSERVATION_BATCH_SIZE * MAXIMUM_RELEASE_OBSERVATION_BATCHES);
    const partial = boundedIds.length < ids.length;
    const observed = new Map<string, string>();
    async function read(ids: string[]) {
        const { data, error } = await client.from("release_observations")
            .select("release_id,first_observed_at").in("release_id", ids).abortSignal(deadline);
        if (error || !data) throw new Error("Release observation dates could not be loaded.");
        for (const row of data) {
            if (!ids.includes(row.release_id) || typeof row.first_observed_at !== "string"
                || !Number.isFinite(Date.parse(row.first_observed_at))) {
                throw new Error("Invalid release observation date.");
            }
            observed.set(row.release_id, new Date(row.first_observed_at).toISOString());
        }
    }
    for (let offset = 0; offset < boundedIds.length; offset += RELEASE_OBSERVATION_BATCH_SIZE) {
        const batch = boundedIds.slice(offset, offset + RELEASE_OBSERVATION_BATCH_SIZE);
        await read(batch);
        const missing = batch.filter(id => !observed.has(id));
        if (missing.length > 0) {
            const { error } = await client.from("release_observations")
                .upsert(missing.map(release_id => ({ release_id })), { onConflict: "release_id", ignoreDuplicates: true }).abortSignal(deadline);
            if (error) throw new Error("Release observation dates could not be recorded.");
            // Read after insert so overlapping requests retain the winning database timestamp.
            await read(missing);
        }
    }
    if (observed.size !== boundedIds.length) throw new Error("Release observation dates are incomplete.");
    return withPartial(builds.map(build => {
        const id = identities.get(build.buildId);
        return id ? { ...build, firstObservedAt: observed.get(id) } : build;
    }), partial);
}
