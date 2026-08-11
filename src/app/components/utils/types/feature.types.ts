import type { LucideIcon } from "lucide-react";

export type FeatureCard = "hero" | "image" | "text" | "wide";

export type CoopFeature = {
    id: string;
    eyebrow?: string;
    title: string;
    description: string;
    icon?: LucideIcon;
    image?: string;
    imageAlt?: string;
    variant: FeatureCard;
    className: string;
}

