import { redirect } from "next/navigation";

type LegacyLiveServerPageProps = {
    params: Promise<{ serverId: string }>;
};

export default async function LegacyLiveServerPage({ params }: LegacyLiveServerPageProps) {
    const { serverId } = await params;
    redirect(`/servers/${encodeURIComponent(serverId)}`);
}
