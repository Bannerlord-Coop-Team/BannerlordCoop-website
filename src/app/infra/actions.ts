"use server";

import { hasAdminAccess } from "@/app/lib/auth/access";
import {
    createManagedIonosServer,
    destroyManagedIonosServer,
    IonosClientError,
} from "@/app/lib/ionos/client";
import { isIonosServerCreationEnabled } from "@/app/lib/ionos/config";
import { isIonosServerPreset } from "@/app/lib/ionos/resources";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function infraUrl(key: "ionosError" | "ionosSuccess", value: string) {
    return `/infra?${new URLSearchParams({ [key]: value }).toString()}`;
}

async function requireAdmin() {
    const sessionClient = await getSupabaseServerClient();
    const { data } = await sessionClient.auth.getUser();

    if (!data.user) redirect("/login?next=/infra");
    if (!hasAdminAccess(data.user)) {
        redirect(
            infraUrl(
                "ionosError",
                "Your current Supabase session does not have the Admin role. Refresh the session or sign in again after a role change.",
            ),
        );
    }
}

function operationError(error: unknown) {
    if (error instanceof IonosClientError) return error.userMessage;

    console.error("IONOS server operation failed", error);
    return "The IONOS operation failed. Try again in a moment.";
}

export async function createIonosServer(formData: FormData) {
    await requireAdmin();

    if (!isIonosServerCreationEnabled()) {
        redirect(
            infraUrl(
                "ionosError",
                "IONOS server creation is disabled while alternative hosting options are evaluated.",
            ),
        );
    }

    const location = String(formData.get("location") ?? "").trim().slice(0, 50);
    const preset = String(formData.get("preset") ?? "");
    const sshPublicKey = String(formData.get("sshPublicKey") ?? "").trim().slice(0, 9000);

    if (!isIonosServerPreset(preset)) {
        redirect(infraUrl("ionosError", "Choose a valid server preset."));
    }

    let serverName: string;

    try {
        const server = await createManagedIonosServer({
            location,
            preset,
            sshPublicKey,
        });
        serverName = server.name;
    } catch (error) {
        redirect(infraUrl("ionosError", operationError(error)));
    }

    revalidatePath("/infra");
    redirect(
        infraUrl(
            "ionosSuccess",
            `${serverName} is being provisioned in IONOS.`,
        ),
    );
}

export async function destroyIonosServer(formData: FormData) {
    await requireAdmin();

    const datacenterId = String(formData.get("datacenterId") ?? "");
    const serverId = String(formData.get("serverId") ?? "");
    let serverName: string;

    try {
        const server = await destroyManagedIonosServer(datacenterId, serverId);
        serverName = server.name;
    } catch (error) {
        redirect(infraUrl("ionosError", operationError(error)));
    }

    revalidatePath("/infra");
    redirect(
        infraUrl(
            "ionosSuccess",
            `${serverName} is being destroyed in IONOS.`,
        ),
    );
}
