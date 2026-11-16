"use client";

import { createContext, useContext, useId, useRef, useState, type ReactNode } from "react";
import {
    FOLDED_STEPS,
    hoistWarnings,
    type Block,
    type Distro,
    type GuideCopy,
    type Inline,
    type Section,
    distroPanels,
} from "./guide-model";
import codeText from "./content/code.json";

const scripts = codeText as Record<string, string>;

type GuideContextValue = {
    copy: GuideCopy;
    distro: Distro | null;
    sections: Section[];
    showFolded: boolean;
    forceOpenId?: string;
    onStatus: (message: string) => void;
};

const GuideContext = createContext<GuideContextValue | null>(null);

function useGuide(): GuideContextValue {
    const value = useContext(GuideContext);
    if (!value) throw new Error("Guide blocks rendered outside the guide");
    return value;
}

function InlineText({ nodes }: { nodes: Inline[] }) {
    const { copy } = useGuide();
    return (
        <>
            {nodes.map((node, index) => {
                if (node.t === "text") return <span key={index}>{copy.t(node.v)}</span>;
                if (node.t === "br") return <br key={index} />;
                if (node.t === "code") return <code key={index}>{node.v}</code>;
                if (node.t === "strong") return <strong key={index}><InlineText nodes={node.c} /></strong>;
                if (node.t === "em") return <em key={index}><InlineText nodes={node.c} /></em>;
                if (node.t === "a") {
                    const external = node.href.startsWith("http");
                    return (
                        <a key={index} href={node.href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>
                            <InlineText nodes={node.c} />
                        </a>
                    );
                }
                return (
                    <button key={index} type="button" className="term-def" data-term={copy.t(node.term)} data-def={copy.t(node.def)}>
                        {copy.t(node.v || node.term)}
                    </button>
                );
            })}
        </>
    );
}

function CodeBlock({ block }: { block: Extract<Block, { type: "code" }> }) {
    const { copy, onStatus } = useGuide();
    const preRef = useRef<HTMLPreElement>(null);
    const [state, setState] = useState<"" | "copied" | "failed">("");
    const source = scripts[block.id] ?? "";

    async function copySource() {
        const done = (next: "" | "copied" | "failed") => {
            setState(next);
            onStatus(copy.t(next === "copied" ? "Copied" : next === "failed" ? "Selected — copy manually" : "Copy"));
            if (next) window.setTimeout(() => setState(""), next === "copied" ? 2200 : 4000);
        };
        try {
            await navigator.clipboard.writeText(source);
            done("copied");
        } catch {
            const node = preRef.current;
            if (node) {
                const range = document.createRange();
                range.selectNodeContents(node);
                const selection = window.getSelection();
                selection?.removeAllRanges();
                selection?.addRange(range);
            }
            done("failed");
        }
    }

    const pre = (
        <pre ref={preRef} className="code-pre" tabIndex={0}>
            <code>{source}</code>
        </pre>
    );
    if (block.bare) return pre;

    return (
        <figure className={block.oneshot ? "code-fig oneshot-fig" : "code-fig"}>
            <figcaption className="code-cap">
                <span className="code-cap-left">
                    <span className="code-cap-title"><InlineText nodes={block.title} /></span>
                    <span className="code-lang">{copy.t(block.langLabel)}</span>
                </span>
                <span className="code-cap-actions">
                    <button type="button" className={`btn btn-sm${state === "copied" ? " is-copied" : ""}${state === "failed" ? " is-failed" : ""}`} onClick={copySource}>
                        {copy.t(state === "copied" ? "Copied" : state === "failed" ? "Selected — copy manually" : "Copy")}
                    </button>
                    {block.id === "ai-prompt-pre" && (
                        <a className="btn btn-sm" href="/linux/LINUX.md" download="LINUX.md" title={copy.t("Optional: save LINUX.md only")}>
                            {copy.t("Download .md")}
                        </a>
                    )}
                </span>
            </figcaption>
            {pre}
        </figure>
    );
}

function Tabs({ block }: { block: Extract<Block, { type: "tabs" }> }) {
    const { copy, distro } = useGuide();
    const baseId = useId();
    const [active, setActive] = useState(0);
    const familyPanels = distroPanels(distro?.family, block.name);
    const distroScoped = Boolean(distro) && (block.name === "oneshot" || block.name === "deps" || block.name === "steam");
    const visible = block.tabs
        .map((tab, index) => ({ tab, index }))
        .filter(({ tab, index }) => {
            if (!distroScoped) return true;
            if (block.name === "oneshot") return tab.script === distro?.id;
            if (familyPanels == null) return true;
            return familyPanels.includes(index);
        });
    const stacked = distroScoped;

    if (stacked) {
        return (
            <div className="tab-widget is-distro-view" data-tabs={block.name}>
                {visible.map(({ tab, index }) => (
                    <div key={index} className="distro-panel" role="group" aria-label={copy.t(tab.label)}>
                        <Blocks blocks={tab.blocks} />
                    </div>
                ))}
            </div>
        );
    }

    const selected = visible[Math.min(active, Math.max(visible.length - 1, 0))] ?? visible[0];
    return (
        <div className="tab-widget" data-tabs={block.name}>
            <div role="tablist" aria-label={copy.t(block.label)} className="tab-list">
                {visible.map(({ tab, index }, position) => {
                    const on = selected?.index === index;
                    return (
                        <button
                            key={index}
                            type="button"
                            role="tab"
                            id={`${baseId}-tab-${position}`}
                            className={on ? "tab is-active" : "tab"}
                            aria-selected={on}
                            aria-controls={`${baseId}-panel-${position}`}
                            tabIndex={on ? 0 : -1}
                            onClick={() => setActive(position)}
                            onKeyDown={(event) => {
                                const next = event.key === "ArrowRight" ? position + 1 : event.key === "ArrowLeft" ? position - 1 : event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : null;
                                if (next == null) return;
                                event.preventDefault();
                                const wrapped = (next + visible.length) % visible.length;
                                setActive(wrapped);
                            }}
                        >
                            {copy.t(tab.label)}
                        </button>
                    );
                })}
            </div>
            {selected && (
                <div role="tabpanel" id={`${baseId}-panel-${visible.indexOf(selected)}`} aria-labelledby={`${baseId}-tab-${visible.indexOf(selected)}`} className="tab-panel" tabIndex={0}>
                    <Blocks blocks={selected.tab.blocks} />
                </div>
            )}
        </div>
    );
}

function DetailsBlock({ block }: { block: Extract<Block, { type: "details" }> }) {
    const { copy, sections, showFolded, forceOpenId } = useGuide();
    const folded = block.className?.includes("oneshot-steps");
    if (folded && !showFolded) return null;
    const className = ["guide-details", block.className].filter(Boolean).join(" ");
    return (
        <details className={className} id={block.id || undefined} open={forceOpenId && block.id === forceOpenId ? true : undefined}>
            <summary><InlineText nodes={block.summary} /></summary>
            {folded ? (
                <div className="oneshot-steps-body">
                    {FOLDED_STEPS.map((id) => {
                        const section = sections.find((item) => item.id === id);
                        if (!section) return null;
                        return (
                            <section key={id} className="oneshot-sub">
                                <h3>{copy.t(section.title)}</h3>
                                <Blocks blocks={hoistWarnings(section.blocks)} />
                            </section>
                        );
                    })}
                </div>
            ) : (
                <Blocks blocks={block.blocks} />
            )}
        </details>
    );
}

function Blocks({ blocks }: { blocks: Block[] }) {
    const { copy } = useGuide();
    return (
        <>
            {blocks.map((block, index) => {
                switch (block.type) {
                    case "p":
                        return (
                            <p key={index} className={block.role === "lead" ? "oneshot-lead" : block.role === "safe" ? "oneshot-safe" : block.role === "muted" ? "muted" : undefined}>
                                {block.key ? copy.tKey(block.key, block.c.map((node) => (node.t === "text" ? node.v : "")).join("")) : <InlineText nodes={block.c} />}
                            </p>
                        );
                    case "h3":
                        return <h3 key={index}><InlineText nodes={block.c} /></h3>;
                    case "ul":
                    case "ol":
                        return (
                            <List key={index} tag={block.type} className={block.className} items={block.items} />
                        );
                    case "callout":
                        return (
                            <div key={index} id={block.id || undefined} className={`callout callout-${block.kind}`}>
                                <p className="callout-title">{copy.t(block.title)}</p>
                                <div className="callout-body"><Blocks blocks={block.blocks} /></div>
                            </div>
                        );
                    case "tabs":
                        return <Tabs key={index} block={block} />;
                    case "code":
                        return <CodeBlock key={index} block={block} />;
                    case "details":
                        return <DetailsBlock key={index} block={block} />;
                    case "rich":
                        return <div key={index} className="faq-a" dangerouslySetInnerHTML={{ __html: copy.rich(block.id) }} />;
                    case "table":
                        return <GuideTable key={index} block={block} />;
                    case "dl":
                        return (
                            <dl key={index} className="var-list">
                                {block.items.map((item, itemIndex) => (
                                    <div key={itemIndex}>
                                        <dt><InlineText nodes={item.dt} /></dt>
                                        <dd><InlineText nodes={item.dd} /></dd>
                                    </div>
                                ))}
                            </dl>
                        );
                    case "field":
                        return (
                            <label key={index} className="field-label">
                                <InlineText nodes={block.label} />
                                <input className="var-input" type="text" placeholder={block.placeholder} autoComplete="off" />
                            </label>
                        );
                    case "columns":
                        return (
                            <div key={index} className="oneshot-cols">
                                {block.columns.map((column, columnIndex) => (
                                    <div key={columnIndex} className="oneshot-col"><Blocks blocks={column.blocks} /></div>
                                ))}
                            </div>
                        );
                    default:
                        return null;
                }
            })}
        </>
    );
}

function List({ tag, className, items }: { tag: "ul" | "ol"; className?: string; items: Inline[][] }) {
    const Tag = tag;
    return (
        <Tag className={className || undefined}>
            {items.map((item, index) => (
                <li key={index}><InlineText nodes={item} /></li>
            ))}
        </Tag>
    );
}

function GuideTable({ block }: { block: Extract<Block, { type: "table" }> }) {
    const { copy } = useGuide();
    const headers = block.headers.map((header) => copy.t(header));
    return (
        <table id={block.id || undefined}>
            <thead>
                <tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr>
            </thead>
            <tbody>
                {block.rows.map((row, rowIndex) => (
                    <tr key={row.id || rowIndex} id={row.id || undefined}>
                        {row.cells.map((cell, cellIndex) => (
                            <td key={cellIndex} data-label={headers[cellIndex] || ""}><InlineText nodes={cell} /></td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/** Renders one guide section. Folded setup steps are only offered from the one-script step. */
export function GuideSection({ section, wizard = false, alone = false }: { section: Section; wizard?: boolean; alone?: boolean }) {
    const guide = useGuide();
    const { copy } = guide;
    const Heading = alone && !wizard ? "h1" : "h2";
    return (
        <div className={wizard ? "wiz-inner" : "doc-section"} id={wizard ? undefined : `sec-${section.id}`}>
            <div className="step-head">
                <p className="step-kicker">{copy.t(section.kicker)}</p>
                <Heading className="step-title" id={alone && !wizard ? "manual-title" : undefined}>{copy.t(section.title)}</Heading>
                {section.sub ? <p className="step-sub">{copy.t(section.sub)}</p> : null}
            </div>
            <div className={`step-body${section.id === "terminal" ? " oneshot" : ""}`}>
                <GuideContext.Provider value={{ ...guide, showFolded: alone && section.id === "terminal" }}>
                    <Blocks blocks={hoistWarnings(section.blocks)} />
                </GuideContext.Provider>
            </div>
        </div>
    );
}

export function GuideProvider({
    value,
    children,
}: {
    value: GuideContextValue;
    children: ReactNode;
}) {
    return <GuideContext.Provider value={value}>{children}</GuideContext.Provider>;
}

export function scopeSvg(svg: string, suffix: string): string {
    return svg
        .replace(/\bid="([^"]+)"/g, (_, id: string) => `id="${id}-${suffix}"`)
        .replace(/url\(#([^)]+)\)/g, (_, id: string) => `url(#${id}-${suffix})`);
}
