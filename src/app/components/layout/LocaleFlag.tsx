import type { ReactNode } from "react";
import type { Locale } from "@/app/lib/localization/types";

/** Returns polygon points for a five-pointed star centred on the given point. */
function starPoints(cx: number, cy: number, radius: number) {
    return Array.from({ length: 10 }, (_, index) => {
        const angle = -Math.PI / 2 + (index * Math.PI) / 5;
        const distance = index % 2 === 0 ? radius : radius * 0.4;
        return `${(cx + distance * Math.cos(angle)).toFixed(2)},${(cy + distance * Math.sin(angle)).toFixed(2)}`;
    }).join(" ");
}

/** Draws one Korean trigram as three bars perpendicular to its flag diagonal. */
function Trigram({ x, y, angle }: { x: number; y: number; angle: number }) {
    return <g transform={`translate(${x} ${y}) rotate(${angle})`} fill="#000">
        {[-1.6, -0.3, 1].map((offset) => <rect key={offset} x={-2} y={offset} width={4} height={0.7} />)}
    </g>;
}

// Simplified 3:2 flags stay recognizable at selector size; English uses the US and Spanish uses Spain.
const flags: Record<Locale, ReactNode> = {
    en: <>
        <rect width="30" height="20" fill="#fff" />
        {Array.from({ length: 7 }, (_, index) => <rect key={index} y={index * 3.08} width="30" height="1.54" fill="#B22234" />)}
        <rect width="12" height="10.77" fill="#3C3B6E" />
    </>,
    "zh-CN": <>
        <rect width="30" height="20" fill="#EE1C25" />
        <polygon points={starPoints(5, 5, 3)} fill="#FFFF00" />
        {[[10, 2], [12, 4], [12, 7], [10, 9]].map(([x, y]) => <polygon key={`${x}-${y}`} points={starPoints(x, y, 1)} fill="#FFFF00" />)}
    </>,
    ru: <>
        <rect width="30" height="20" fill="#fff" />
        <rect y="6.67" width="30" height="6.67" fill="#0039A6" />
        <rect y="13.33" width="30" height="6.67" fill="#D52B1E" />
    </>,
    es: <>
        <rect width="30" height="20" fill="#AA151B" />
        <rect y="5" width="30" height="10" fill="#F1BF00" />
    </>,
    "pt-BR": <>
        <rect width="30" height="20" fill="#009C3B" />
        <polygon points="3,10 15,2 27,10 15,18" fill="#FFDF00" />
        <circle cx="15" cy="10" r="4.5" fill="#002776" />
    </>,
    "pt-PT": <>
        <rect width="30" height="20" fill="#FF0000" />
        <rect width="12" height="20" fill="#006600" />
        <circle cx="12" cy="10" r="3.6" fill="#FFCC00" />
        <circle cx="12" cy="10" r="2.2" fill="#FF0000" />
    </>,
    ja: <>
        <rect width="30" height="20" fill="#fff" />
        <circle cx="15" cy="10" r="6" fill="#BC002D" />
    </>,
    ko: <>
        <rect width="30" height="20" fill="#fff" />
        <g transform="translate(15 10) rotate(33.7)">
            <path d="M-5 0A5 5 0 0 1 5 0Z" fill="#CD2E3A" />
            <path d="M-5 0A5 5 0 0 0 5 0Z" fill="#0047A0" />
            <circle cx="-2.5" r="2.5" fill="#CD2E3A" />
            <circle cx="2.5" r="2.5" fill="#0047A0" />
        </g>
        <Trigram x={6} y={4} angle={-56.3} />
        <Trigram x={24} y={16} angle={-56.3} />
        <Trigram x={24} y={4} angle={56.3} />
        <Trigram x={6} y={16} angle={56.3} />
    </>,
};

/** Renders the decorative flag representing a supported website language. */
export function LocaleFlag({ locale }: { locale: Locale }) {
    return <svg viewBox="0 0 30 20" aria-hidden="true" focusable="false" className="h-3.5 w-5 shrink-0 rounded-[2px] ring-1 ring-white/20">
        {flags[locale]}
    </svg>;
}
