const STATE_EXPLANATIONS: Record<string, string> = {
    "awaiting-save": "The slot is prepared and stopped while the default campaign save is being established.",
    available: "The resource is ready for use.",
    cancelled: "The durable job was cancelled at a safe checkpoint and will not continue.",
    configuring: "The assigned slot is being configured before it can be started.",
    degraded: "The server is responding, but one or more health checks are failing.",
    deleted: "The managed server has completed its deletion workflow.",
    deleting: "Deletion is in progress through the retained backup and cleanup workflow.",
    "deletion-pending": "Deletion is scheduled but still inside its cancellation or retention window.",
    disabled: "This setting is currently turned off.",
    drifted: "Observed provider or agent state does not match the control plane's expected composition.",
    enabled: "This setting is currently turned on.",
    failed: "The operation reached a terminal failure and needs administrator review.",
    healthy: "The most recent bounded health evidence passed.",
    maintenance: "The server is inside a controlled update, backup, or maintenance workflow.",
    "not-onboarded": "The VPS is registered in provider inventory but its managed runner has not completed enrollment.",
    pending: "The build is recorded but is not approved for installation until its receipt is validated.",
    provisioning: "A prepared hosting slot is being assigned and initialized.",
    queued: "The durable job is waiting for a worker lease.",
    rejected: "The pending build was reviewed and permanently rejected; it cannot be installed.",
    "retry-wait": "The job encountered a retryable failure and will run again after its backoff.",
    revoked: "A previously validated build was withdrawn and cannot be selected for new installs.",
    running: "The game container is confirmed running by current runner-agent evidence.",
    starting: "The control plane has requested startup but has not yet received confirmed running evidence.",
    stopped: "The game container is intentionally off. The owner or an administrator can start it.",
    stopping: "A graceful stop is in progress and the final stopped state has not yet been confirmed.",
    succeeded: "The durable job completed and committed its terminal evidence.",
    suspended: "An administrator placed the server on hold. Owner operations are blocked until it is reactivated.",
    unavailable: "Current evidence says this resource or dependency cannot be used.",
    unknown: "The control plane does not yet have current, trustworthy evidence for this state.",
    validated: "The immutable build receipt passed validation and the build is eligible for installation.",
};

const JOB_ACTION_EXPLANATIONS: Record<string, string> = {
    backup: "Creates and verifies an encrypted off-host backup of the current campaign state.",
    "console-command": "Runs one allowlisted game-console operation through the restricted controller.",
    delete: "Runs the retained final-backup and managed deletion workflow for a server.",
    "delete-save": "Deletes one selected save generation after ownership and reference checks.",
    "export-data": "Builds a bounded encrypted export of the owner's managed-hosting data.",
    "export-save": "Exports one selected campaign save through the private object-store path.",
    "force-stop": "Uses the emergency server-side stop path when graceful shutdown cannot complete.",
    "import-save": "Validates and imports an uploaded campaign save without replacing unrelated generations.",
    "migrate-region": "Relocates a server to a prepared slot on another registered VPS, then cuts over after backup, restore and health checks.",
    provision: "Assigns and initializes the server's prepared provider slot and immutable composition.",
    reactivate: "Clears an administrative suspension after entitlement and lifecycle checks.",
    rebuild: "Retired: rebuilt a dynamically provisioned provider generation from an image. Shown only on historical jobs.",
    "reboot-vm": "Retired: rebooted a dynamically provisioned provider generation. Shown only on historical jobs.",
    reconcile: "Compares desired state with provider and runner evidence, records drift, and queues only bounded repairs when needed.",
    "reset-password": "Rotates the game password through the encrypted secret boundary and applies the new configuration.",
    resize: "Retired: resized a dynamically provisioned provider generation. Shown only on historical jobs.",
    "restart-game": "Gracefully stops and starts the game container while preserving its assigned slot and data.",
    restore: "Restores one exact verified backup after current-generation and stopped-state checks.",
    rollback: "Returns the server to its retained prior immutable build using the guarded rollback workflow.",
    start: "Starts the assigned game container and waits for current runner evidence before reporting it running.",
    stop: "Gracefully stops the game container; the shared VPS host remains powered on.",
    suspend: "Blocks owner operations and safely stops the game container under an administrative hold.",
    transfer: "Moves ownership through entitlement, capacity, state, and provider-generation checks.",
    update: "Installs the selected validated immutable build with backup, compatibility, and health gates.",
};

const OPERATION_EXPLANATIONS: Record<string, string> = {
    "batch-maintenance": "Takes a bounded fleet snapshot and queues eligible server updates. It does not bypass compatibility, backup, or current-state checks.",
    "cancel-deletion": "Cancels a pending deletion only while entitlement and lifecycle rules still permit cancellation.",
    "cancel-job": "Requests cancellation. A running worker stops only at its next reviewed safe checkpoint.",
    "create-notice": "Shows a plain-text notice at the top of up to 500 selected servers' pages to everyone who can view them, until each person dismisses it, it expires or it is withdrawn. It is not an email or a Discord message.",
    "collect-diagnostics": "Collects a bounded, sanitized diagnostic window. Secrets, arbitrary files, and general shell access remain unavailable.",
    "create-server": "Assigns one free slot from an already registered VPS in stopped state; it never purchases a VPS product or starts Bannerlord. If no prepared slot exists in the selected region, the request fails without creating or billing anything.",
    diagnostics: "Reads the sanitized result of a completed diagnostics job; it cannot read arbitrary runner files.",
    "execute-deletion": "Advances an eligible pending deletion through its final backup, retention, and cleanup gates.",
    "extend-deletion": "Moves an existing pending-deletion deadline forward by the selected bounded duration.",
    "force-reconcile": "Immediately compares every managed server's desired state with current provider and runner evidence. It records drift and queues bounded repair work, but does not buy VPS products or start intentionally stopped servers.",
    "inspect-build": "Shows the persisted non-secret provenance for one exact release build without changing its state.",
    "placement-plan": "Learns from reconcile history when each server is usually online and proposes which servers should share a VPS so fewer are online together and, where measured, each VPS has the CPU its servers need. It is a dry run: nothing is reserved, queued or relocated until an administrator runs a step.",
    "raise-vps-slot-capacity": "Raises one onboarded VPS's slot capacity, never lowering it, up to 32. A slot reserves no cores: placement plans about 1.6 vCPU for each server online together and prefers VPSs whose servers rarely are, but more online at once than that fits (about three on a 6-vCPU VPS) share its cores and slow each other. The control plane re-commissions the VPS for the new slots without touching its running servers, and refuses the request unless HOSTING_DYNAMIC_SLOT_CAPACITY is on.",
    "decommission-vps-slots": "Lowers one OVHcloud VPS's slot capacity by retiring its highest slots and tearing them down on the VPS, never moving a server: the slots it retires must be empty, so it waits (draining) while any holds a server and only new servers go to the kept slots meanwhile. The kept servers keep running. The control plane refuses it unless HOSTING_DYNAMIC_SLOT_CAPACITY is on and automatic slot sizing is off, and keeps at least floor(vCPU / 2) slots.",
    "cancel-vps-slot-decommission": "Cancels one VPS's open slot decommission plan before it retires a slot, clearing the slot target it set. A decommission that has retired slots rolls forward instead. It answers that nothing changed when no plan is open.",
    "resolve-vps-slot-decommission-kept-slots": "Records an administrator's resolution after a decommission's kept-slot check failed: each listed kept slot is accepted as it is now or repaired, and the decommission job runs again to compare every kept slot.",
    "reactivate-server": "Clears an administrative hold after current entitlement checks. It does not automatically start the game.",
    "onboard-manual-vps-host": "Registers one already-purchased VPS from a provider without an account API using the facts you type, then runs the same onboarding as an account VPS. It connects as root only to the entered public IPv4, scans and pins the host key on first contact as it does for an account VPS, checks the country and location against the chosen region's placement, records floor(vCPU / 2) slots, and publishes capacity only after health proof. It never orders, renews, or cancels the VPS. Retry a failed attempt from the VPS view.",
    "onboard-vps-host": "Verifies one already-purchased VPS from its API provider's authenticated account inventory (OVHcloud or Contabo), pins the Ed25519 SSH identity presented at its provider-derived public IP on first contact, uses the preinstalled fleet key, hardens the host, installs and activates every isolated managed-runner slot through private mTLS routes, and publishes capacity only after health proof. It never orders, renews, or cancels the VPS, and accepts no browser-supplied host identity or topology.",
    "reject-build": "Permanently marks a pending build rejected while retaining its receipt and audit history.",
    "relocate-server": "Moves one server to a free slot on another VPS in a published region through a migrate-region job. A running game stops for the move, and the server's address and game port change.",
    "reset-password": "Generates or accepts a new game password, stores it through the encrypted secret boundary, and reveals generated output once.",
    "restore-backup": "Restores one exact retained backup only after stale-state, ownership, stopped-state, and compatibility checks.",
    "retry-job": "Moves an eligible failed or retry-wait job back to the durable queue without creating a duplicate operation.",
    "acknowledge-job-failure": "Acknowledges one exact failed attempt. The job and audit evidence remain retained, but that attempt no longer contributes to the Overview failed-job alert.",
    "revoke-build": "Withdraws a validated build from future selection while retaining its immutable receipt and audit history.",
    "rollback-server": "Reinstalls and pins the previous release in this channel while keeping the current campaign and taking a safety backup.",
    "server-operation": "Queues a lifecycle action for the selected server generation. Stop affects only the game container; provider-host actions use separate guarded paths.",
    "set-bonus-quota": "Replaces one owner's administrative bonus quota; it does not manufacture a membership entitlement.",
    "set-build-pin": "Pins one exact validated build or clears the pin so the server follows its selected release channel.",
    "set-global-controls": "Atomically replaces all four live pause switches and records the administrator reason. Checked means that workflow is currently paused.",
    "set-placement-executor": "Switches the automatic placement executor on or off. While it is on, the control plane follows the placement plan by itself, one relocation at a time, under fixed rules: each move saves at least 20 pair-hours a week or removes at least 1 core-hour a week of expected CPU shortage (or a mix of the two), a stopped server moves at once and stays stopped, a running server moves after an hour's notice on its page and in-game warnings, and always-on servers move only to one-slot VPSs.",
    "set-manager": "Grants or revokes bounded manager access. Managers do not receive ownership, deletion, export, or administrative capabilities.",
    "suspend-server": "Places an administrative hold on the server, blocks owner operations, cancels unsafe expanding jobs, and queues a graceful stop.",
    "transfer-owner": "Transfers ownership only after recipient entitlement, quota, active-job, and provider-generation checks.",
    "update-vps-runner": "Deploys the control plane's current reviewed runner revision across every isolated slot on one onboarded VPS. The durable workflow quiesces and restores the slots, verifies build and save continuity, and rolls back on failed validation; it accepts no browser-supplied SSH or executable input.",
    "update-server": "Installs the selected version. Choose a specific GHCR version to pin it, or Follow channel to remove the pin and resume automatic updates.",
    "update-settings": "Changes the release channel or maintenance window with a stale-state guard; it does not immediately install a build.",
    "withdraw-notice": "Hides a server notice for everyone at once. Its record, targets and dismissal counts are kept.",
    "validate-build": "Re-verifies the exact persisted release receipt and promotes a pending build only if all provenance and artifact checks still agree.",
};

const DESTRUCTIVE_EXPLANATIONS: Record<string, string> = {
    "cancel-job": "Cancelling can leave the requested outcome incomplete, so the worker stops only at a safe checkpoint.",
    "execute-deletion": "This can permanently remove the managed server after final-backup and retention gates.",
    "reject-build": "Rejection is terminal for this build record and cannot be undone.",
    "relocate-server": "Relocation stops a running game and changes the server's address and game port.",
    "reset-password": "Existing clients will lose access after the password changes.",
    "restore-backup": "Restoring replaces the current campaign state with the selected backup generation.",
    "revoke-build": "Revocation prevents new selection of a previously validated build.",
    "rollback-server": "This reinstalls an older build while keeping the current campaign. It does not restore an older save.",
    "set-placement-executor": "While enabled, the control plane relocates customer servers by itself, stopping their games and changing their addresses and game ports.",
    "server-operation": "This card includes delete and emergency-stop actions with material service impact.",
    "suspend-server": "Suspension blocks owner operations and stops the game container.",
    "transfer-owner": "Ownership, access, and future lifecycle authority move to another website account.",
};

const AUDIT_ACTION_EXPLANATIONS: Record<string, string> = {
    "hosting.admin.job_failure_acknowledged": "An administrator acknowledged one exact failed job attempt. The job and its audit evidence remain retained.",
    "hosting.admin.ovhcloud_vps_host_registration_requested": "An administrator requested that an existing VPS be verified and added to managed inventory.",
    "hosting.admin.ovhcloud_vps_runner_onboarding_requested": "An administrator requested full managed-runner commissioning for an existing VPS.",
    "hosting.admin.ovhcloud_vps_runner_update_requested": "An administrator requested a transactional host-wide managed-runner update to the control plane's reviewed revision.",
    "hosting.admin.ovhcloud_vps_slot_capacity_raised": "An administrator raised a VPS's slot capacity and requeued its runner onboarding to commission the new slots.",
    "hosting.admin.manual_vps_slot_capacity_raised": "An administrator raised a VPS's slot capacity and requeued its runner onboarding to commission the new slots.",
    "hosting.admin.ovhcloud_vps_slot_decommission_requested": "An administrator requested a VPS slot decommission and the control plane recorded its plan: the slot target drops to the slots kept, and the slots it retires take no new server.",
    "hosting.admin.manual_vps_slot_decommission_requested": "An administrator requested a VPS slot decommission and the control plane recorded its plan: the slot target drops to the slots kept, and the slots it retires take no new server.",
    "hosting.admin.ovhcloud_vps_slot_decommission_queued": "An administrator's slot decommission was queued: the slots it retires were empty, so the VPS's runner onboarding was requeued to retire and tear them down.",
    "hosting.admin.manual_vps_slot_decommission_queued": "An administrator's slot decommission was queued: the slots it retires were empty, so the VPS's runner onboarding was requeued to retire and tear them down.",
    "hosting.admin.ovhcloud_vps_slot_decommission_replanned": "An administrator re-planned an interrupted slot decommission as a recovery, which resumes the recorded teardown.",
    "hosting.admin.manual_vps_slot_decommission_replanned": "An administrator re-planned an interrupted slot decommission as a recovery, which resumes the recorded teardown.",
    "hosting.admin.ovhcloud_vps_slot_decommission_cancelled": "An administrator cancelled a VPS's open slot decommission plan before it retired a slot and cleared the slot target it set.",
    "hosting.admin.manual_vps_slot_decommission_cancelled": "An administrator cancelled a VPS's open slot decommission plan before it retired a slot and cleared the slot target it set.",
    "hosting.admin.ovhcloud_vps_slot_decommission_kept_resolved": "An administrator accepted or repaired the kept slots a slot decommission's continuity check failed on, and requeued the decommission job.",
    "hosting.admin.manual_vps_slot_decommission_kept_resolved": "An administrator accepted or repaired the kept slots a slot decommission's continuity check failed on, and requeued the decommission job.",
    "hosting.runner.ovhcloud_vps_slots_retired": "A slot decommission retired the VPS's empty highest slots, its point of no return: they take no server and are torn down next.",
    "hosting.runner.manual_vps_slots_retired": "A slot decommission retired the VPS's empty highest slots, its point of no return: they take no server and are torn down next.",
    "hosting.placement.ovhcloud_vps_slot_target_changed": "A VPS's slot target changed: automatic slot sizing moved it, or an administrator's slot decommission plan set or cleared it. New servers go only to slots below the target.",
    "hosting.placement.manual_vps_slot_target_changed": "A VPS's slot target changed: automatic slot sizing moved it, or an administrator's slot decommission plan set or cleared it. New servers go only to slots below the target.",
    "hosting.runner.ovhcloud_vps_slot_capacity_lowered": "A slot decommission finished: the VPS's retired slots were torn down, its kept servers passed their continuity checks, and its slot capacity was lowered.",
    "hosting.runner.manual_vps_slot_capacity_lowered": "A slot decommission finished: the VPS's retired slots were torn down, its kept servers passed their continuity checks, and its slot capacity was lowered.",
    "hosting.admin.server_create_requested": "An administrator requested assignment of existing managed capacity to a website account.",
    "hosting.admin.server_reactivated": "An administrator removed the server's administrative hold. Reactivation does not automatically start the game.",
    "hosting.admin.server_suspended": "An administrator placed the server on hold, blocked owner operations, and queued a graceful game stop.",
    "hosting.provider.ovhcloud_vps_host_registered": "The control plane verified and recorded an existing VPS as inventory. This event alone does not publish schedulable capacity.",
    "hosting.reconciliation.scheduled": "The control plane scheduled a desired-versus-observed state comparison for a managed server.",
    "hosting.runner.ovhcloud_vps_onboarding_succeeded": "Every reviewed runner slot passed installation, private-route, identity, activation, and health gates before capacity was published.",
    "hosting.runner.ovhcloud_vps_update_succeeded": "Every isolated slot passed revision, identity, build, save, and capability continuity checks after the runner update.",
    "hosting.runner.ovhcloud_vps_update_failed": "A managed-runner update stopped safely after a terminal failure and retained its evidence and rollback target.",
    "hosting.runner.ovhcloud_vps_update_retry_scheduled": "A retryable managed-runner update failure was retained and scheduled for bounded recovery.",
};

export function stateExplanation(value: string) {
    return STATE_EXPLANATIONS[value] ?? "This is the control plane's current durable state for the item.";
}

export function jobActionExplanation(action: string) {
    return JOB_ACTION_EXPLANATIONS[action] ?? "This is a typed durable control-plane job; its progress and terminal evidence are retained.";
}

export function operationExplanation(operation: string) {
    return OPERATION_EXPLANATIONS[operation] ?? "Runs the named typed administrator workflow with authorization, stale-state, idempotency, and audit checks.";
}

export function destructiveExplanation(operation: string) {
    return DESTRUCTIVE_EXPLANATIONS[operation] ?? "This operation can materially change managed-hosting state and requires confirmation.";
}

export function auditActionExplanation(action: string) {
    const exact = AUDIT_ACTION_EXPLANATIONS[action];
    if (exact) return exact;
    const readable = action.replace(/^hosting\./u, "").replaceAll(/[._-]+/gu, " ");
    if (action.startsWith("hosting.job.")) {
        return `Hash-chained evidence for a durable job transition: ${readable}.`;
    }
    if (action.startsWith("hosting.admin.")) {
        return `Hash-chained evidence for an authorized administrative action: ${readable}.`;
    }
    if (action.startsWith("hosting.provider") || action.startsWith("hosting.runner.")) {
        return `Hash-chained evidence recorded at a provider or managed-runner boundary: ${readable}.`;
    }
    return `Hash-chained control-plane evidence: ${readable}.`;
}
