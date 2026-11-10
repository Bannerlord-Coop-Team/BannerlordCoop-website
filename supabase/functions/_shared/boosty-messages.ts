// UNVERIFIED Boosty dialog/message response parser, isolated so commissioning can confirm it
// against a captured real response. Shapes follow the unofficial beekamai/boosty-api types:
// dialogs `{data:[{id, chatmate:{id}, lastMessage:{id, createdAt}}], extra:{offset}}` and
// messages `{data:[{id, authorId|author:{id}, createdAt, isDeleted, data:[{type:"text", content}]}]}`.
// Only that allowlisted subset is read; anything else in the body is ignored.
import { record } from "./membership.ts";
import { extractLinkCode } from "./boosty-link-code.ts";

export const DIALOG_PAGE_SIZE = 20;
export const MESSAGE_PAGE_SIZE = 20;
const MAX_CONTENT_LENGTH = 4096;
const MAX_BLOCKS = 50;
const DECIMAL_OFFSET = /^(0|[1-9][0-9]{0,19})$/u;

export type BoostyDialog = { dialogId: string; chatmateId: string | null; lastMessageId: string | null; lastMessageAt: string | null };
export type BoostyDialogPage = { dialogs: BoostyDialog[]; nextOffset: string | null };
export type BoostyCodeMessage = { messageId: string; authorId: string | null; messageAt: string | null; code: string | null };

/** Reads a positive safe integer id as its decimal string, or null when absent or malformed. */
function id(value: unknown): string | null {
    return Number.isSafeInteger(value) && (value as number) > 0 ? String(value) : null;
}

/** Converts Boosty Unix seconds into a UTC millisecond timestamp, or null when absent or implausible. */
function unixSeconds(value: unknown): string | null {
    if (!Number.isSafeInteger(value) || (value as number) < 1_500_000_000 || (value as number) > 4_000_000_000) return null;
    return new Date((value as number) * 1000).toISOString();
}

/** Parses one dialog list page; a page or dialog without a valid id is refused. */
export function parseDialogPage(value: unknown): BoostyDialogPage {
    if (!record(value) || !Array.isArray(value.data) || value.data.length > DIALOG_PAGE_SIZE) throw new Error("Invalid Boosty dialog page");
    const dialogs = value.data.map(entry => {
        const dialogId = record(entry) ? id(entry.id) : null;
        if (!record(entry) || dialogId === null) throw new Error("Invalid Boosty dialog");
        const last = record(entry.lastMessage) ? entry.lastMessage : null;
        return { dialogId, chatmateId: record(entry.chatmate) ? id(entry.chatmate.id) : null, lastMessageId: last ? id(last.id) : null, lastMessageAt: last ? unixSeconds(last.createdAt) : null };
    });
    const offset = record(value.extra) ? value.extra.offset : undefined;
    const nextOffset = Number.isSafeInteger(offset) && (offset as number) >= 0 ? String(offset) : typeof offset === "string" && DECIMAL_OFFSET.test(offset) ? offset : null;
    return { dialogs, nextOffset: dialogs.length === 0 ? null : nextOffset };
}

/** Concatenates the text blocks of one message; other block kinds never carry a code. */
function messageText(blocks: unknown): string {
    if (!Array.isArray(blocks)) return "";
    return blocks.slice(0, MAX_BLOCKS).filter(block => record(block) && block.type === "text" && typeof block.content === "string" && block.content.length <= MAX_CONTENT_LENGTH)
        .map(block => (block as { content: string }).content).join("\n");
}

/** Parses one message page into code candidates; deleted or id-less messages are skipped. */
export function parseMessagePage(value: unknown): BoostyCodeMessage[] {
    if (!record(value) || !Array.isArray(value.data) || value.data.length > MESSAGE_PAGE_SIZE) throw new Error("Invalid Boosty message page");
    return value.data.flatMap(entry => {
        const messageId = record(entry) ? id(entry.id) : null;
        if (!record(entry) || messageId === null || entry.isDeleted === true) return [];
        const authorId = id(entry.authorId) ?? (record(entry.author) ? id(entry.author.id) : null);
        return [{ messageId, authorId, messageAt: unixSeconds(entry.createdAt), code: extractLinkCode(messageText(entry.data)) }];
    });
}
