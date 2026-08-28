import assert from "node:assert/strict";
import test from "node:test";
import type { ReleaseBuild } from "./types";
import { installableBuilds, overviewStatRowClass } from "./presentation";

function build(buildId: string, validationState: string, sourceRevision: string): ReleaseBuild {
    return {
        buildId,
        channel: "nightly",
        version: buildId,
        sourceRevision,
        supportedGameVersion: "v1.2.12",
        validationState,
        publishedAt: "2026-08-27T00:00:00.000Z",
        updatedAt: "2026-08-27T00:00:00.000Z",
    };
}

test("the normal release catalog keeps only validated builds and their commit revisions", () => {
    const validated = build("validated", "validated", "a".repeat(40));
    const visible = installableBuilds([
        build("pending", "pending", "b".repeat(40)),
        validated,
        build("rejected", "rejected", "c".repeat(40)),
    ]);

    assert.deepEqual(visible, [validated]);
    assert.equal(visible[0]?.sourceRevision, "a".repeat(40));
});

test("overview statistic cards fill the final row evenly", () => {
    assert.equal(overviewStatRowClass(1), "grid-cols-1");
    assert.match(overviewStatRowClass(2), /sm:grid-cols-2/u);
    assert.match(overviewStatRowClass(3), /lg:grid-cols-3/u);
    assert.match(overviewStatRowClass(4), /lg:grid-cols-4/u);
    assert.throws(() => overviewStatRowClass(0));
    assert.throws(() => overviewStatRowClass(5));
});
