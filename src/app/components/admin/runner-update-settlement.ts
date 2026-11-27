import type { HostingAdminVpsHost } from "@/app/lib/control-plane/types";

export function runnerUpdateSettlement(update: HostingAdminVpsHost["runnerUpdate"]): string | null {
    if (update?.state !== "failed") return null;
    switch (update.errorCode) {
        case "runner_isolated_rolled_back": return "The rollback was verified and the prior runner revision is active.";
        case "runner_isolated_applied_recovered": return "Recovery verified the applied runner revision and completed the update.";
        case "runner_update_not_applied": return "The attempt ended before the runner was switched.";
        default: return null;
    }
}
