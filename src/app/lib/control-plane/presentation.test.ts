import assert from "node:assert/strict";
import test from "node:test";
import type { ReleaseBuild } from "./types";
import {
    fieldRequirementLabel,
    installableBuilds,
    operationCardRowClass,
    operationCardRows,
    operationTargetMatchesHash,
    overviewStatRowClass,
} from "./presentation";

test("operation fields explicitly identify required and optional inputs", () => {
    assert.equal(fieldRequirementLabel(true), "Required");
    assert.equal(fieldRequirementLabel(false), "Optional");
});

test("operation deep links match their rendered card after hydration", () => {
    assert.equal(operationTargetMatchesHash("#onboard-vps-host", "onboard-vps-host"), true);
    assert.equal(operationTargetMatchesHash("#onboard%2Dvps%2Dhost", "onboard-vps-host"), true);
    assert.equal(operationTargetMatchesHash("#create-server", "onboard-vps-host"), false);
    assert.equal(operationTargetMatchesHash("#%E0%A4%A", "onboard-vps-host"), false);
});

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

test("operation cards group similar input density into balanced rows", () => {
    const cards = [
        { operation: "onboard", fields: Array.from({ length: 7 }) },
        { operation: "create", fields: Array.from({ length: 6 }) },
        { operation: "force", fields: [] },
        { operation: "review", fields: [] },
        { operation: "open-review", fields: [true] },
        { operation: "cleanup", fields: Array.from({ length: 3 }) },
        { operation: "controls", fields: Array.from({ length: 6 }) },
    ];

    assert.deepEqual(
        operationCardRows(cards).map((row) => row.map((card) => card.operation)),
        [
            ["onboard", "create"],
            ["controls", "cleanup"],
            ["open-review", "force", "review"],
        ],
    );
    assert.deepEqual(
        operationCardRows([
            { operation: "retry", fields: [true, true] },
            { operation: "cancel", fields: [true, true] },
            { operation: "diagnostics", fields: [true] },
        ]).map((row) => row.map((card) => card.operation)),
        [["retry", "cancel"], ["diagnostics"]],
    );
});

test("operation card rows expand to their row width", () => {
    assert.equal(operationCardRowClass(1), "grid-cols-1");
    assert.match(operationCardRowClass(2), /md:grid-cols-2/u);
    assert.match(operationCardRowClass(3), /xl:grid-cols-3/u);
    assert.throws(() => operationCardRowClass(0));
    assert.throws(() => operationCardRowClass(4));
});
