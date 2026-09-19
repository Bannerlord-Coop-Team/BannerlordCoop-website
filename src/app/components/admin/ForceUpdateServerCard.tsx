import { ControlPlaneActionCard, type AdminActionField } from "./ControlPlaneActionCard";

// Not mounted in Operations until the backend contract and exact-request retry are verified.
export function ForceUpdateServerCard({ serverField }: { serverField: AdminActionField }) {
    return <ControlPlaneActionCard
        operation="force-update-server"
        title="Force Update"
        description="Resolve the latest GHCR image for this server's configured Stable or Nightly channel to an immutable digest, then reinstall it—even when that digest is already installed."
        destructive
        destructiveReason="This operation takes a safety backup and stops the game for installation. Players will be disconnected. Existing rollback safeguards still apply."
        help="Uses the server's configured channel, not a caller-selected tag or image URL. An accepted job is not confirmation that installation has completed; check its progress."
        fields={[serverField, { name: "reason", label: "Audit reason", kind: "textarea", required: true }]}
    />;
}
