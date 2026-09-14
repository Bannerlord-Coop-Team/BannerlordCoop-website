import "server-only";

export type RoadmapItem = {
    id: string;
    title: string;
    description: string;
    status: "completed" | "unstable" | "in_progress" | "planned";
};

export type RoadmapMilestone = {
    id: string;
    title: string;
    roadmap_items: RoadmapItem[];
};

export async function getRoadmap(): Promise<RoadmapMilestone[]> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return [];

    try {
        const parameters = new URLSearchParams({
            select: "id,title,roadmap_items(id,title,description,status)",
            order: "sort_order.asc,id.asc",
            "roadmap_items.order": "sort_order.asc,id.asc",
        });
        const response = await fetch(`${url}/rest/v1/roadmap_milestones?${parameters}`, {
            headers: { apikey: key },
            next: { revalidate: 60 },
        });
        if (!response.ok) {
            throw new Error(`Roadmap request failed with status ${response.status}.`);
        }
        return (await response.json()) as RoadmapMilestone[];
    } catch (error) {
        console.error("Unable to retrieve roadmap.", error);
        return [];
    }
}
