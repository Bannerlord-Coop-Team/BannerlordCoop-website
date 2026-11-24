import "server-only";
import { fetchPublicRows, type PublicRowsReader } from "./supabase/public-rows";

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

const roadmapQuery = {
    select: "id,title,title_translation_key,roadmap_items(id,title,title_translation_key,description,description_translation_key,status)",
    order: "sort_order.asc,id.asc",
    "roadmap_items.order": "sort_order.asc,id.asc",
};

// Optional override for the row reader; omitted, it defaults to the live Supabase read.
export type RoadmapDependencies = {
    readRows?: PublicRowsReader<RoadmapMilestone>;
};

// Loads public roadmap rows and explicit translation identities without altering source content.
export function getRoadmap({ readRows = fetchPublicRows }: RoadmapDependencies = {}): Promise<RoadmapMilestone[]> {
    return readRows("roadmap_milestones", roadmapQuery);
}
