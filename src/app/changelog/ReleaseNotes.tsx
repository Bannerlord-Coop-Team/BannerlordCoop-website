import type { ReactNode } from "react";

type ReleaseNotesProps = {
    body: string;
};

type NotesBlock =
    | {
    type: "heading";
    level: 1 | 2 | 3;
    text: string;
}
    | {
    type: "paragraph";
    text: string;
}
    | {
    type: "list";
    ordered: boolean;
    items: string[];
};

export function ReleaseNotes({ body }: ReleaseNotesProps) {
    const blocks = parseBlocks(body);

    if (blocks.length === 0) {
        return (
            <p className="text-sm italic leading-7 text-foreground-dim">
                No release notes were provided for this version.
            </p>
        );
    }

    return (
        <div className="space-y-5">
            {blocks.map((block, index) => {
                const key = `${block.type}-${index}`;

                if (block.type === "heading") {
                    const headingClassName =
                        block.level === 1
                            ? "font-display text-3xl font-semibold text-foreground"
                            : block.level === 2
                                ? "font-display text-2xl font-semibold text-foreground"
                                : "font-label text-sm font-semibold uppercase tracking-[0.14em] text-gold";

                    if (block.level === 1) {
                        return (
                            <h3 key={key} className={headingClassName}>
                                {renderInline(block.text)}
                            </h3>
                        );
                    }

                    if (block.level === 2) {
                        return (
                            <h4 key={key} className={headingClassName}>
                                {renderInline(block.text)}
                            </h4>
                        );
                    }

                    return (
                        <h5 key={key} className={headingClassName}>
                            {renderInline(block.text)}
                        </h5>
                    );
                }

                if (block.type === "list") {
                    const List = block.ordered ? "ol" : "ul";

                    return (
                        <List
                            key={key}
                            className={
                                block.ordered
                                    ? "list-decimal space-y-2 pl-5 text-sm leading-7 text-foreground-muted marker:text-gold sm:text-base"
                                    : "space-y-2 text-sm leading-7 text-foreground-muted sm:text-base"
                            }
                        >
                            {block.items.map((item, itemIndex) => (
                                <li
                                    key={`${key}-${itemIndex}`}
                                    className={
                                        block.ordered
                                            ? "pl-2"
                                            : "flex items-start gap-3"
                                    }
                                >
                                    {!block.ordered && (
                                        <span
                                            aria-hidden="true"
                                            className="mt-[0.7rem] size-1.5 shrink-0 rotate-45 bg-gold-muted"
                                        />
                                    )}

                                    <span>{renderInline(item)}</span>
                                </li>
                            ))}
                        </List>
                    );
                }

                return (
                    <p
                        key={key}
                        className="text-sm leading-7 text-foreground-muted sm:text-base"
                    >
                        {renderInline(block.text)}
                    </p>
                );
            })}
        </div>
    );
}

function parseBlocks(markdown: string): NotesBlock[] {
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
    const blocks: NotesBlock[] = [];
    let paragraphLines: string[] = [];
    let listItems: string[] = [];
    let orderedList = false;

    function flushParagraph() {
        if (paragraphLines.length === 0) {
            return;
        }

        blocks.push({
            type: "paragraph",
            text: paragraphLines.join(" ").trim(),
        });

        paragraphLines = [];
    }

    function flushList() {
        if (listItems.length === 0) {
            return;
        }

        blocks.push({
            type: "list",
            ordered: orderedList,
            items: listItems,
        });

        listItems = [];
    }

    for (const sourceLine of lines) {
        const line = sourceLine.trim();

        if (!line) {
            flushParagraph();
            flushList();
            continue;
        }

        const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);

        if (headingMatch) {
            flushParagraph();
            flushList();

            blocks.push({
                type: "heading",
                level: headingMatch[1].length as 1 | 2 | 3,
                text: headingMatch[2].trim(),
            });

            continue;
        }

        const unorderedMatch = line.match(/^[-*+]\s+(.+)$/);

        if (unorderedMatch) {
            flushParagraph();

            if (listItems.length > 0 && orderedList) {
                flushList();
            }

            orderedList = false;
            listItems.push(unorderedMatch[1].trim());
            continue;
        }

        const orderedMatch = line.match(/^\d+[.)]\s+(.+)$/);

        if (orderedMatch) {
            flushParagraph();

            if (listItems.length > 0 && !orderedList) {
                flushList();
            }

            orderedList = true;
            listItems.push(orderedMatch[1].trim());
            continue;
        }

        flushList();
        paragraphLines.push(line);
    }

    flushParagraph();
    flushList();

    return blocks;
}

function renderInline(text: string): ReactNode[] {
    const tokens =
        /(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s<]+)/g;

    return text.split(tokens).filter(Boolean).map((part, index) => {
        const markdownLink = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);

        if (markdownLink) {
            return (
                <a
                    key={index}
                    href={markdownLink[2]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gold underline decoration-gold/40 underline-offset-4 transition-colors hover:text-foreground"
                >
                    {markdownLink[1]}
                </a>
            );
        }

        if (part.startsWith("**") && part.endsWith("**")) {
            return (
                <strong key={index} className="font-semibold text-foreground">
                    {part.slice(2, -2)}
                </strong>
            );
        }

        if (part.startsWith("`") && part.endsWith("`")) {
            return (
                <code
                    key={index}
                    className="border border-white/10 bg-surface-raised px-1.5 py-0.5 font-mono text-[0.9em] text-foreground"
                >
                    {part.slice(1, -1)}
                </code>
            );
        }

        if (/^https?:\/\//.test(part)) {
            const trailingPunctuation = part.match(/[.,;:!?]+$/)?.[0] ?? "";
            const href = trailingPunctuation
                ? part.slice(0, -trailingPunctuation.length)
                : part;

            return (
                <span key={index}>
                    <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gold underline decoration-gold/40 underline-offset-4 transition-colors hover:text-foreground"
                    >
                        {href}
                    </a>
                    {trailingPunctuation}
                </span>
            );
        }

        return part;
    });
}