import assert from "node:assert/strict";
import test from "node:test";
import {
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
});

test("gives destructive cards a concrete warning", () => {
    assert.match(destructiveExplanation("suspend-server"), /blocks owner operations/iu);
});
