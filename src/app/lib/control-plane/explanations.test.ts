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

test("explains reconciliation and OVH assignment boundaries", () => {
    assert.match(jobActionExplanation("reconcile"), /desired state/iu);
    assert.match(operationExplanation("force-reconcile"), /intentionally stopped/iu);
    assert.match(operationExplanation("review-orphans"), /never deletes/iu);
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
});

test("explains exact and structured audit actions", () => {
    assert.match(auditActionExplanation("hosting.admin.server_suspended"), /hold/iu);
    assert.match(auditActionExplanation("hosting.job.stop.succeeded"), /durable job transition/iu);
    assert.match(auditActionExplanation("hosting.provider.synthetic_observation"), /provider/iu);
});
