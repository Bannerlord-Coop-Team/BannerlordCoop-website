import "server-only";

import { getTranslations } from "@/app/lib/localization/server";
import { MyServersApiError } from "./my-servers";

/** Localizes the existing owner API code, which covers IPC disconnects and IPC timeouts. */
export async function ownerMaintenanceMessage(error: unknown): Promise<string | undefined> {
    if (!(error instanceof MyServersApiError) || error.code !== "control_plane_unavailable") return undefined;
    const { t } = await getTranslations("server-common");
    return t("error.maintenance");
}
