import type { CSSProperties } from "react";

// One gold ramp from the surface to full gold for the ten heatmap bands: a darker cell is less likely to be online.
export const HEATMAP_CLASSES = ["bg-gold/10", "bg-gold/20", "bg-gold/30", "bg-gold/40", "bg-gold/50", "bg-gold/60", "bg-gold/70", "bg-gold/80", "bg-gold/90", "bg-gold"] as const;

/** An hour without data is hatched, so it never reads as an hour that was measured as nothing. */
export const HEATMAP_NO_DATA: CSSProperties = { backgroundImage: "repeating-linear-gradient(135deg, rgb(255 255 255 / 0.22) 0 1px, transparent 1px 3px)" };
