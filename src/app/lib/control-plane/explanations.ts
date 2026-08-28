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
    "migrate-region": "Creates a replacement provider generation in another approved region, then cuts over after restore and health checks.",
    provision: "Assigns and initializes the server's prepared provider slot and immutable composition.",
    reactivate: "Clears an administrative suspension after entitlement and lifecycle checks.",
    rebuild: "Creates a replacement provider generation from an approved image and restores the retained state.",
    reboot: "Reboots the managed provider generation through the fixed infrastructure workflow.",
    "reboot-vm": "Reboots the managed provider generation through the fixed infrastructure workflow.",
    reconcile: "Compares desired state with provider and runner evidence, records drift, and queues only bounded repairs when needed.",
    "reset-password": "Rotates the game password through the encrypted secret boundary and applies the new configuration.",
    resize: "Creates a replacement provider generation at an approved size and performs a guarded cutover.",
    restart: "Gracefully stops and starts the game container while preserving its assigned slot and data.",
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
    "announce-owners": "Queues a bounded private notification campaign for entitled managed-hosting owners. It does not post publicly or allow mentions.",
    "batch-maintenance": "Takes a bounded fleet snapshot and queues eligible server updates. It does not bypass compatibility, backup, or current-state checks.",
    "cancel-deletion": "Cancels a pending deletion only while entitlement and lifecycle rules still permit cancellation.",
    "cancel-job": "Requests cancellation. A running worker stops only at its next reviewed safe checkpoint.",
    "cleanup-orphan": "Queues cleanup for one exact digest from a prior orphan review. It cannot target new or unreviewed provider resources.",
    "collect-diagnostics": "Collects a bounded, sanitized diagnostic window. Secrets, arbitrary files, and general shell access remain unavailable.",
    "create-server": "Assigns one free slot from an already registered OVH VPS; it never purchases an OVH product. If no prepared slot exists in the selected region, the request fails without creating or billing anything.",
    diagnostics: "Reads the sanitized result of a completed diagnostics job; it cannot read arbitrary runner files.",
    "execute-deletion": "Advances an eligible pending deletion through its final backup, retention, and cleanup gates.",
    "extend-deletion": "Moves an existing pending-deletion deadline forward by the selected bounded duration.",
    "force-reconcile": "Immediately compares every managed server's desired state with current provider and runner evidence. It records drift and queues bounded repair work, but does not buy VPS products or start intentionally stopped servers.",
    "inspect-build": "Shows the persisted non-secret provenance for one exact release build without changing its state.",
    "open-orphan-review": "Reads a previously captured orphan review and its immutable cleanup-group digests.",
    "orphan-review": "Reads a previously captured orphan review and its immutable cleanup-group digests.",
    "reactivate-server": "Clears an administrative hold after current entitlement checks. It does not automatically start the game.",
    "register-vps-host": "Registers one already-purchased OVH VPS as empty cattle capacity after verifying that the service belongs to the configured OVH account. It never orders, renews, starts, or assigns anything.",
    "reject-build": "Permanently marks a pending build rejected while retaining its receipt and audit history.",
    "replace-provider": "Creates a guarded replacement generation for resize, rebuild, or migration, then cuts over only after backup, restore, and health checks.",
    "reset-password": "Generates or accepts a new game password, stores it through the encrypted secret boundary, and reveals generated output once.",
    "restore-backup": "Restores one exact retained backup only after stale-state, ownership, stopped-state, and compatibility checks.",
    "retry-job": "Moves an eligible failed or retry-wait job back to the durable queue without creating a duplicate operation.",
    "review-orphans": "Creates a read-only snapshot of provider resources that do not match current managed state. Review alone never deletes or changes a provider resource.",
    "revoke-build": "Withdraws a validated build from future selection while retaining its immutable receipt and audit history.",
    "rollback-server": "Queues the retained prior-build rollback path with backup and compatibility gates.",
    "server-operation": "Queues a lifecycle action for the selected server generation. Stop affects only the game container; provider-host actions use separate guarded paths.",
    "set-bonus-quota": "Replaces one owner's administrative bonus quota; it does not manufacture a Discord entitlement.",
    "set-build-pin": "Pins one exact validated build or clears the pin so the server follows its selected release channel.",
    "set-global-controls": "Atomically replaces all five live pause switches and records the administrator reason. Checked means that workflow is currently paused.",
    "set-manager": "Grants or revokes bounded manager access. Managers do not receive ownership, deletion, export, or administrative capabilities.",
    "suspend-server": "Places an administrative hold on the server, blocks owner operations, cancels unsafe expanding jobs, and queues a graceful stop.",
    "transfer-owner": "Transfers ownership only after recipient entitlement, quota, active-job, and provider-generation checks.",
    "update-server": "Resolves the selected channel to a validated immutable build and queues a guarded update when a newer eligible build exists.",
    "update-settings": "Changes the release channel or maintenance window with a stale-state guard; it does not immediately install a build.",
    "validate-build": "Re-verifies the exact persisted release receipt and promotes a pending build only if all provenance and artifact checks still agree.",
};

const DESTRUCTIVE_EXPLANATIONS: Record<string, string> = {
    "cancel-job": "Cancelling can leave the requested outcome incomplete, so the worker stops only at a safe checkpoint.",
    "cleanup-orphan": "This may remove provider resources after exact review-digest and current-state revalidation.",
    "execute-deletion": "This can permanently remove the managed server after final-backup and retention gates.",
    "reject-build": "Rejection is terminal for this build record and cannot be undone.",
    "replace-provider": "This replaces the active provider generation after a guarded cutover.",
    "reset-password": "Existing clients will lose access after the password changes.",
    "restore-backup": "Restoring replaces the current campaign state with the selected backup generation.",
    "revoke-build": "Revocation prevents new selection of a previously validated build.",
    "rollback-server": "Rollback changes the installed build and may require a one-way save compatibility decision.",
    "server-operation": "This card includes delete, reboot, and emergency-stop actions with material service impact.",
    "suspend-server": "Suspension blocks owner operations and stops the game container.",
    "transfer-owner": "Ownership, access, and future lifecycle authority move to another Discord account.",
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
