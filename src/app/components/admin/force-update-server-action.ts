import type { ComponentProps } from "react";
import type { ControlPlaneActionCard, AdminActionField } from "./ControlPlaneActionCard";

export function forceUpdateServerAction(serverField: AdminActionField) {
    return {
        group: "Server lifecycle",
        operation: "force-update-server",
        title: "Force Update",
        description: "Resolve the latest GHCR image for this server's configured Stable or Nightly channel to an immutable digest, then reinstall it—even when that digest is already installed. Replaces the existing build pin; clear the pin afterward to resume catalog maintenance. Source revision and game/client compatibility are unknown. Existing client download details are only a baseline, not verification of this image. Confirm it is appropriate for the campaign. Running games restart; stopped games stay stopped.",
        destructive: true,
        destructiveReason: "This operation takes a safety backup and stops running games for installation. Players will be disconnected. Existing rollback safeguards still apply.",
        help: "Uses the server's configured channel, not a caller-selected tag or image URL. Registry authorization is not an Actions-validated release receipt. An accepted job is not confirmation that installation has completed; check its progress.",
        fields: [serverField, { name: "reason", label: "Audit reason", kind: "textarea", required: true }],
    } satisfies ComponentProps<typeof ControlPlaneActionCard> & { group: string };
}
