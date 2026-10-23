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
    assert.match(stateExplanation("suspended"), /subscription or administrator/iu);
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
    assert.match(operationExplanation("onboard-manual-vps-host"), /without an account API/iu);
    assert.match(operationExplanation("onboard-manual-vps-host"), /scans and pins the host key on first contact/iu);
    assert.doesNotMatch(operationExplanation("onboard-manual-vps-host"), /pasted/iu);
    assert.match(operationExplanation("onboard-manual-vps-host"), /floor\(vCPU \/ 2\)/u);
    assert.match(operationExplanation("onboard-manual-vps-host"), /never orders/iu);
    assert.match(operationExplanation("update-vps-runner"), /every isolated slot/iu);
    assert.match(operationExplanation("update-vps-runner"), /no browser-supplied ssh/iu);
    assert.match(operationExplanation("raise-vps-slot-capacity"), /never lowering it/iu);
    assert.match(operationExplanation("raise-vps-slot-capacity"), /reserves no cores/iu);
    assert.match(operationExplanation("raise-vps-slot-capacity"), /HOSTING_DYNAMIC_SLOT_CAPACITY/u);
    assert.match(auditActionExplanation("hosting.admin.ovhcloud_vps_slot_capacity_raised"), /raised a VPS's slot capacity/u);
    assert.equal(auditActionExplanation("hosting.admin.manual_vps_slot_capacity_raised"),
        auditActionExplanation("hosting.admin.ovhcloud_vps_slot_capacity_raised"));
});

test("labels slot decommission operations and their audit actions", () => {
    assert.match(operationExplanation("decommission-vps-slots"), /never moving a server/iu);
    assert.match(operationExplanation("decommission-vps-slots"), /HOSTING_DYNAMIC_SLOT_CAPACITY/u);
    assert.match(operationExplanation("decommission-vps-slots"), /floor\(vCPU \/ 2\)/u);
    assert.match(operationExplanation("cancel-vps-slot-decommission"), /rolls forward/iu);
    assert.match(operationExplanation("resolve-vps-slot-decommission-kept-slots"), /accepted as it is now or repaired/iu);
    assert.match(auditActionExplanation("hosting.placement.ovhcloud_vps_slot_target_changed"), /decommission plan set or cleared it/u);
    assert.match(auditActionExplanation("hosting.runner.ovhcloud_vps_slot_capacity_lowered"), /slot capacity was lowered/u);
    assert.equal(auditActionExplanation("hosting.placement.manual_vps_slot_target_changed"),
        auditActionExplanation("hosting.placement.ovhcloud_vps_slot_target_changed"));
    assert.equal(auditActionExplanation("hosting.runner.manual_vps_slot_capacity_lowered"),
        auditActionExplanation("hosting.runner.ovhcloud_vps_slot_capacity_lowered"));
    const decommissionActions: Array<[string, RegExp]> = [
        ["hosting.admin.ovhcloud_vps_slot_decommission_requested", /requested a VPS slot decommission/u],
        ["hosting.admin.ovhcloud_vps_slot_decommission_queued", /decommission was queued/u],
        ["hosting.admin.ovhcloud_vps_slot_decommission_replanned", /re-planned an interrupted slot decommission/u],
        ["hosting.admin.ovhcloud_vps_slot_decommission_cancelled", /cancelled a VPS's open slot decommission plan/u],
        ["hosting.admin.ovhcloud_vps_slot_decommission_kept_resolved", /accepted or repaired the kept slots/u],
        ["hosting.runner.ovhcloud_vps_slots_retired", /point of no return/u],
    ];
    for (const [action, text] of decommissionActions) {
        assert.match(auditActionExplanation(action), text);
        assert.equal(auditActionExplanation(action.replace(".ovhcloud_vps_", ".manual_vps_")), auditActionExplanation(action));
    }
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
