import { redirect } from "next/navigation";

type LegacyLiveServerPageProps = {
    params: Promise<{ serverId: string }>;
};

/** Preserves legacy live-server links by redirecting to the unified management route. */
export default async function LegacyLiveServerPage({ params }: LegacyLiveServerPageProps) {
    const { serverId } = await params;
    redirect(`/servers/${encodeURIComponent(serverId)}`);
}
