import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { ReleaseBuild } from "./types";
import {
    fieldRequirementLabel,
    installableBuilds,
    operationCardRowClass,
    operationCardRows,
    operationTargetMatchesHash,
    overviewStatRowClass,
    presentControlPlaneOperationResult,
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

test("create-server success explains stopped state without hiding its one-time password", () => {
    const serverId = "11111111-1111-4111-8111-111111111111";
    const presented = presentControlPlaneOperationResult("create-server", {
        outcome: "assigned",
        generatedPassword: "one-time-password",
        job: null,
        server: {
            serverId,
            displayName: "Calradia",
            operationState: "stopped",
        },
    });

    assert.match(presented.message, /created in stopped state/iu);
    assert.match(presented.message, /does not start Bannerlord/iu);
    assert.match(presented.message, /one-time-password/u);
    assert.deepEqual(presented.links, [
        {
            href: `/admin/control-plane?view=server&serverId=${serverId}`,
            label: "View server status",
        },
        {
            href: "/admin/control-plane?view=operations#server-operation",
            label: "Open lifecycle controls",
        },
    ]);
});

test("durable job success exposes live progress destinations", () => {
    const serverId = "11111111-1111-4111-8111-111111111111";
    const jobId = "22222222-2222-4222-8222-222222222222";
    const presented = presentControlPlaneOperationResult("server-operation", {
        job: {
            jobId,
            serverId,
            action: "start",
            state: "queued",
            progressStage: "queued",
        },
    });

    assert.equal(
        presented.message,
        `start job ${jobId} is queued at queued. Progress refreshes automatically on its server and Jobs pages.`,
    );
    assert.deepEqual(presented.links, [
        {
            href: `/admin/control-plane?view=server&serverId=${serverId}`,
            label: "View server status",
        },
        {
            href: `/admin/control-plane?view=jobs&serverId=${serverId}`,
            label: "Track job progress",
        },
    ]);
});

test("result links reject untrusted non-UUID identifiers", () => {
    const presented = presentControlPlaneOperationResult("server-operation", {
        job: { jobId: "../job", serverId: "javascript:alert(1)" },
    });

    assert.deepEqual(presented.links, []);
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

test("fleet onboarding and server creation remain paired after onboarding becomes one-click", () => {
    const cards = [
        { operation: "onboard", fields: [true] },
        { operation: "create", fields: Array.from({ length: 5 }) },
        { operation: "controls", fields: Array.from({ length: 6 }) },
        { operation: "force", fields: [] },
    ];

    assert.deepEqual(
        operationCardRows(cards, 2).map((row) => row.map((card) => card.operation)),
        [["onboard", "create"], ["controls"], ["force"]],
    );
});

test("failed and legacy runner rows expose the typed service-only onboarding action", async () => {
    const source = await readFile(
        new URL("../../components/admin/RunnerOnboardingStatus.tsx", import.meta.url),
        "utf8",
    );

    assert.match(source, /operation: "onboard-vps-host"/u);
    assert.match(source, /input: \{ serviceName, mode: onboarding === null \? "enroll" : "retry" \}/u);
    assert.match(source, /Retry onboarding/u);
    assert.match(source, /Onboard runner/u);
    assert.doesNotMatch(source, /hostPublicKey/u);
});

test("operation card rows expand to their row width", () => {
    assert.equal(operationCardRowClass(1), "grid-cols-1");
    assert.match(operationCardRowClass(2), /md:grid-cols-2/u);
    assert.match(operationCardRowClass(3), /xl:grid-cols-3/u);
    assert.throws(() => operationCardRowClass(0));
    assert.throws(() => operationCardRowClass(4));
});
