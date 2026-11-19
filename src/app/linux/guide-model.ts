import enToKey from "./content/en-to-key.json";
import type { GuidePack } from "./messages";

export type Inline =
    | { t: "text"; v: string }
    | { t: "br" }
    | { t: "code"; v: string }
    | { t: "strong"; c: Inline[] }
    | { t: "em"; c: Inline[] }
    | { t: "a"; href: string; c: Inline[] }
    | { t: "term"; term: string; def: string; v: string };

export type Block =
    | { type: "p"; c: Inline[]; key?: string; role?: string }
    | { type: "h3"; c: Inline[] }
    | { type: "ul" | "ol"; className?: string; items: Inline[][] }
    | { type: "callout"; kind: "warn" | "info" | "ok"; title: string; id?: string; blocks: Block[] }
    | { type: "tabs"; name: string; label: string; tabs: { label: string; script: string | null; blocks: Block[] }[] }
    | { type: "code"; id: string; title: Inline[]; lang: string; langLabel: string; oneshot?: boolean; bare?: boolean }
    | { type: "details"; id?: string; className?: string; summary: Inline[]; blocks: Block[] }
    | { type: "table"; id?: string; headers: string[]; rows: { id?: string; cells: Inline[][] }[] }
    | { type: "dl"; items: { dt: Inline[]; dd: Inline[] }[] }
    | { type: "field"; label: Inline[]; id?: string; name?: string; placeholder?: string }
    | { type: "columns"; columns: { blocks: Block[] }[] }
    | { type: "rich"; id: string };

export type Section = {
    id: string;
    kicker: string;
    title: string;
    sub: string;
    blocks: Block[];
};

export type Distro = {
    id: string;
    family: string;
    color: string;
    glyph: string;
    art: boolean;
    name: string;
    blurbKey: string;
    svg: string;
};

export type GuideRoute =
    | { view: "start" }
    | { view: "distro" }
    | { view: "wizard"; step: string }
    | { view: "manual"; section?: string; openAi?: boolean };

/** Steps that stay inside "Show individual steps" on the one-script page. */
export const FOLDED_STEPS = ["variables", "deps", "steam", "download"] as const;

/** Wizard order after the one-script step is moved to follow the overview. */
export const WIZARD_STEPS = ["overview", "terminal", "configure", "launch", "firewall", "service", "client", "backups", "troubleshooting", "faq", "linux-notes", "agents"] as const;

const panels: Record<string, { deps: number[] | null; steam: number[] | null }> = {
    debian: { deps: [0], steam: [0] },
    fedora: { deps: [1], steam: [1] },
    arch: { deps: [2], steam: [2] },
    suse: { deps: [3], steam: [3] },
    immutable: { deps: [4], steam: [4] },
    deck: { deps: [4, 6], steam: [5] },
    nix: { deps: [5], steam: [6] },
    other: { deps: null, steam: [7] },
};

const keys = enToKey as Record<string, string>;

export type GuideCopy = {
    t: (value: string) => string;
    tKey: (key: string, fallback: string, vars?: Record<string, string | number>) => string;
    nav: (key: string) => string;
    rich: (id: string) => string;
};

/** Looks up guide prose by the original English string. Code is never passed through this. */
export function guideCopy(pack: GuidePack): GuideCopy {
    const strings = pack.strings;
    return {
        t(value) {
            if (!value) return "";
            const key = keys[value];
            if (!key) return value;
            return strings[key] || value;
        },
        tKey(key, fallback, vars) {
            const template = strings[key] || fallback;
            if (!vars) return template;
            return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name: string) => (vars[name] == null ? "" : String(vars[name])));
        },
        nav(key) {
            return pack.nav[key] || "";
        },
        rich(id) {
            return pack.rich[id] || "";
        },
    };
}

/** Which tab panels belong to the chosen distro. Null means the widget is not distro-specific. */
export function distroPanels(family: string | undefined, widget: string): number[] | null | undefined {
    if (!family || !(widget === "deps" || widget === "steam" || widget === "oneshot")) return undefined;
    if (widget === "oneshot") return undefined;
    return panels[family]?.[widget];
}

export function routeHash(route: GuideRoute): string {
    if (route.view === "start") return "#start";
    if (route.view === "distro") return "#distro";
    if (route.view === "wizard") return `#wizard/${encodeURIComponent(route.step)}`;
    if (route.section) return `#manual/${encodeURIComponent(route.section)}`;
    return "#manual";
}

export function parseRoute(hash: string, sectionIds: ReadonlySet<string>): GuideRoute {
    const raw = hash.replace(/^#/, "");
    if (!raw || raw === "start") return { view: "start" };
    const parts = raw.split("/").map((part) => {
        try {
            return decodeURIComponent(part);
        } catch {
            return part;
        }
    });
    const view = parts[0];
    if (view === "ai") return { view: "manual", section: "faq", openAi: true };
    if (view === "sec" && parts[1] && sectionIds.has(parts[1])) return { view: "manual", section: parts[1] };
    if (view === "distro") return { view: "distro" };
    if (view === "wizard") return { view: "wizard", step: parts[1] && (WIZARD_STEPS as readonly string[]).includes(parts[1]) ? parts[1] : WIZARD_STEPS[0] };
    if (view === "manual") {
        const section = parts[1];
        return section && sectionIds.has(section) ? { view: "manual", section } : { view: "manual" };
    }
    if (sectionIds.has(view)) return { view: "manual", section: view };
    return { view: "start" };
}

/** Warnings lead the step. Panels keep their own warnings with the commands they describe. */
export function hoistWarnings(blocks: Block[]): Block[] {
    const warnings = blocks.filter((block) => block.type === "callout" && block.kind === "warn");
    const rest = blocks.filter((block) => !(block.type === "callout" && block.kind === "warn"));
    return [...warnings, ...rest];
}
