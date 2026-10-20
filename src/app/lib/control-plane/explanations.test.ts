import assert from "node:assert/strict";
import test from "node:test";
import {
    auditActionExplanation,
    destructiveExplanation,
    jobActionExplanation,
    operationExplanation,
    stateExplanation,
} from "./explanations";

test("distinguishes stopped and suspended server states", () => {
    assert.match(stateExplanation("stopped"), /can start/iu);
    assert.match(stateExplanation("suspended"), /administrator/iu);
    assert.notEqual(stateExplanation("stopped"), stateExplanation("suspended"));
});

test("explains reconciliation and VPS assignment boundaries", () => {
    assert.match(jobActionExplanation("reconcile"), /desired state/iu);
    assert.match(operationExplanation("force-reconcile"), /intentionally stopped/iu);
    assert.match(operationExplanation("create-server"), /never purchases/iu);
    assert.match(operationExplanation("create-server"), /fails without creating or billing/iu);
    assert.match(operationExplanation("onboard-vps-host"), /already-purchased/iu);
    assert.match(operationExplanation("onboard-vps-host"), /health proof/iu);
    assert.match(operationExplanation("onboard-vps-host"), /never orders/iu);
    assert.match(operationExplanation("onboard-vps-host"), /first contact/iu);
    assert.match(operationExplanation("onboard-vps-host"), /no browser-supplied host identity/iu);
    assert.match(operationExplanation("update-vps-runner"), /every isolated slot/iu);
    assert.match(operationExplanation("update-vps-runner"), /no browser-supplied ssh/iu);
});

test("gives destructive cards a concrete warning", () => {
    assert.match(destructiveExplanation("suspend-server"), /blocks owner operations/iu);
    assert.match(destructiveExplanation("relocate-server"), /address and game port/iu);
});

test("explains server notices and the automatic executor instead of retired owner announcements", () => {
    assert.match(operationExplanation("create-notice"), /until each person dismisses it/iu);
    assert.match(operationExplanation("create-notice"), /not an email or a Discord message/iu);
    assert.match(operationExplanation("withdraw-notice"), /for everyone/iu);
    assert.match(operationExplanation("set-placement-executor"), /by itself/iu);
    // Capacity-aware since control plane #522: pair-hours, CPU shortage removed, or a mix.
    assert.match(operationExplanation("set-placement-executor"), /at least 20 pair-hours a week or removes at least 1 core-hour a week of expected CPU shortage \(or a mix of the two\)/u);
    assert.match(destructiveExplanation("set-placement-executor"), /address/iu);
    assert.doesNotMatch(operationExplanation("announce-owners"), /notification campaign/iu);
});

test("explains that a placement plan relocates nothing by itself", () => {
    assert.match(operationExplanation("placement-plan"), /dry run/iu);
    assert.match(operationExplanation("placement-plan"), /nothing is reserved, queued or relocated/iu);
    assert.match(operationExplanation("placement-plan"), /where measured, each VPS has the CPU its servers need/u);
    assert.match(operationExplanation("relocate-server"), /address and game port change/iu);
});

test("explains exact and structured audit actions", () => {
    assert.match(auditActionExplanation("hosting.admin.server_suspended"), /hold/iu);
    assert.match(auditActionExplanation("hosting.job.stop.succeeded"), /durable job transition/iu);
    assert.match(auditActionExplanation("hosting.provider.synthetic_observation"), /provider/iu);
});
