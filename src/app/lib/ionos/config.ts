import "server-only";

export function isIonosManagementEnabled() {
    return process.env.IONOS_MANAGEMENT_ENABLED === "true";
}

export function isIonosServerCreationEnabled() {
    return (
        isIonosManagementEnabled() &&
        process.env.IONOS_SERVER_CREATION_ENABLED === "true"
    );
}
