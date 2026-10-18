import "server-only";

export type RoadmapItem = {
    id: string;
    title: string;
    title_translation_key?: string | null;
    description: string;
    description_translation_key?: string | null;
    status: "completed" | "experimental" | "in_progress" | "planned";
};

export type RoadmapMilestone = {
    id: string;
    title: string;
    title_translation_key?: string | null;
    roadmap_items: RoadmapItem[];
};

// Loads public roadmap rows and explicit translation identities without altering source content.
export async function getRoadmap(): Promise<RoadmapMilestone[]> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return [];

    try {
        const parameters = new URLSearchParams({
            select: "id,title,title_translation_key,roadmap_items(id,title,title_translation_key,description,description_translation_key,status)",
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
