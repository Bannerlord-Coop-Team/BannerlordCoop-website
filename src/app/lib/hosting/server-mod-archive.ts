import { zipSync, type Zippable } from "fflate";

import type { ServerModArchive } from "./server-mods";
import {
    MOD_ARCHIVE_MAXIMUM_COMPRESSION_RATIO,
    MOD_ARCHIVE_MAXIMUM_ENTRIES,
    MOD_ARCHIVE_MAXIMUM_PATH_BYTES,
    MOD_ARCHIVE_MAXIMUM_PATH_DEPTH,
    MOD_ARCHIVE_MAXIMUM_UNCOMPRESSED_BYTES,
    MOD_ARCHIVE_RATIO_EXEMPT_ENTRY_BYTES,
    MOD_ARCHIVE_RATIO_EXEMPT_TOTAL_BYTES,
    MOD_SUBMODULE_XML_MAXIMUM_BYTES,
    MOD_UPLOAD_MAXIMUM_BYTES,
    isModId,
    isModName,
    isModVersion,
    isReservedModId,
} from "../../../../supabase/functions/_shared/server-mods-contract";

// Builds the archive shape custom-mods.md section 8 requires from a folder the owner picked: one
// top-level directory named exactly the SubModule.xml Id, regular files only, bounded paths, sizes and
// compression ratios. These checks give early feedback; the runner's validation stays authoritative.

const SUBMODULE_FILE_NAME = "SubModule.xml";
const UNSAFE_PATH_CHARACTER = /[\p{Cc}\p{Cf}\\]/u;
/** DOS timestamps cannot be zero; a fixed time keeps the same folder producing the same archive digest. */
const ARCHIVE_MTIME = new Date(Date.UTC(2020, 0, 1));

/** Why a picked folder cannot become an upload, before anything is sent. */
export type ModArchiveProblem =
    | "no-folder" | "multiple-folders" | "no-submodule" | "submodule-invalid" | "invalid-id" | "reserved-id" | "invalid-name"
    | "invalid-version" | "too-many-files" | "too-large-uncompressed" | "too-large" | "invalid-path" | "duplicate-path" | "compression-ratio";

/** A folder that breaks one archive rule; `detail` names the offending file or value when that helps. */
export class ModArchiveError extends Error {
    /** Records the problem and an optional detail for the message. */
    constructor(readonly problem: ModArchiveProblem, readonly detail: string | null = null) {
        super(problem);
        this.name = "ModArchiveError";
    }
}

/** The part of a picked `File` the builder reads; tests supply plain objects. */
export type ModFolderFile = { webkitRelativePath: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };

/** Parses XML text into a document; injected because Node test runs have no `DOMParser`. */
export type XmlParser = (text: string) => Document;

export type ModArchiveOptions = {
    parseXml?: XmlParser;
    /** Lets the browser paint between file reads and before compressing. */
    yieldToBrowser?: () => Promise<void>;
};

/** Zips one picked module folder under its SubModule.xml Id, or throws the first rule it breaks. */
export async function buildModArchive(files: readonly ModFolderFile[], options: ModArchiveOptions = {}): Promise<ServerModArchive> {
    const yieldToBrowser = options.yieldToBrowser ?? (() => Promise.resolve());
    const entries = folderEntries(files);
    const manifest = readSubModuleIdentity(await readText(entries.submodule), options.parseXml ?? defaultXmlParser);
    const paths = archivePaths(entries.files, manifest.id);
    const zippable: Zippable = {};
    for (const [index, file] of entries.files.entries()) {
        zippable[paths[index]] = new Uint8Array(await file.arrayBuffer());
        await yieldToBrowser();
    }
    const bytes = compress(zippable);
    if (bytes.byteLength > MOD_UPLOAD_MAXIMUM_BYTES) throw new ModArchiveError("too-large");
    return { manifest, bytes, fileCount: entries.files.length, uncompressedBytes: entries.totalBytes };
}

/** Returns the folder's files (sorted), its top-level SubModule.xml and total size, after the count and size bounds. */
export function folderEntries(files: readonly ModFolderFile[]) {
    if (files.length === 0) throw new ModArchiveError("no-folder");
    const tops = new Set(files.map(file => file.webkitRelativePath.split("/")[0]));
    if (files.some(file => file.webkitRelativePath.split("/").length < 2)) throw new ModArchiveError("no-folder");
    if (tops.size !== 1) throw new ModArchiveError("multiple-folders");
    const submodule = files.find(file => file.webkitRelativePath.split("/").slice(1).join("/") === SUBMODULE_FILE_NAME);
    if (!submodule) throw new ModArchiveError("no-submodule");
    if (submodule.size > MOD_SUBMODULE_XML_MAXIMUM_BYTES) throw new ModArchiveError("submodule-invalid");
    if (files.length > MOD_ARCHIVE_MAXIMUM_ENTRIES) throw new ModArchiveError("too-many-files");
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MOD_ARCHIVE_MAXIMUM_UNCOMPRESSED_BYTES) throw new ModArchiveError("too-large-uncompressed");
    const sorted = [...files].sort((left, right) => left.webkitRelativePath < right.webkitRelativePath ? -1 : left.webkitRelativePath > right.webkitRelativePath ? 1 : 0);
    return { files: sorted, submodule, totalBytes };
}

/** Reads Id, Name and Version from SubModule.xml with the rules the runner applies to the original file. */
export function readSubModuleIdentity(xml: string, parseXml: XmlParser = defaultXmlParser) {
    // The runner refuses these constructs outright, so they are refused here before parsing.
    if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[|&#/iu.test(xml)) throw new ModArchiveError("submodule-invalid");
    const document = parseXml(xml);
    const root = document.documentElement;
    if (!root || root.nodeName !== "Module" || document.getElementsByTagName("parsererror").length > 0) throw new ModArchiveError("submodule-invalid");
    const value = (name: string) => singleValue(root, name);
    const id = value("Id");
    if (!isModId(id)) throw new ModArchiveError("invalid-id", id);
    if (isReservedModId(id)) throw new ModArchiveError("reserved-id", id);
    const name = value("Name");
    if (!isModName(name)) throw new ModArchiveError("invalid-name", name);
    const version = value("Version");
    if (!isModVersion(version)) throw new ModArchiveError("invalid-version", version);
    // Coop matches only community modules; anything else reads as official and is refused by the runner.
    const moduleType = childElements(root, "ModuleType");
    const official = childElements(root, "Official");
    if (moduleType.length > 1 || (moduleType.length === 1 && moduleType[0].getAttribute("value") !== "Community")
        || official.length > 1 || (official.length === 1 && official[0].getAttribute("value") !== "false")) {
        throw new ModArchiveError("submodule-invalid");
    }
    return { id, name, version };
}

/** Maps each file below the picked folder to `<Id>/<path>`, enforcing the path rules and normalized uniqueness. */
export function archivePaths(files: readonly ModFolderFile[], id: string): string[] {
    const seen = new Set<string>();
    const directories = new Set<string>();
    const paths = files.map(file => {
        const inner = file.webkitRelativePath.split("/").slice(1);
        const segments = [id, ...inner];
        const path = segments.join("/");
        if (inner.some(segment => segment === "" || segment === "." || segment === ".." || UNSAFE_PATH_CHARACTER.test(segment))
            || new TextEncoder().encode(path).byteLength > MOD_ARCHIVE_MAXIMUM_PATH_BYTES || segments.length > MOD_ARCHIVE_MAXIMUM_PATH_DEPTH) {
            throw new ModArchiveError("invalid-path", file.webkitRelativePath);
        }
        const normalized = segments.map(segment => segment.normalize("NFC").toLowerCase());
        const key = normalized.join("/");
        if (seen.has(key)) throw new ModArchiveError("duplicate-path", file.webkitRelativePath);
        seen.add(key);
        for (let depth = 1; depth < normalized.length; depth += 1) directories.add(normalized.slice(0, depth).join("/"));
        return path;
    });
    const clash = [...seen].find(key => directories.has(key));
    if (clash !== undefined) throw new ModArchiveError("duplicate-path", clash);
    return paths;
}

/** Deflates every file, storing any large entry that would exceed the per-entry ratio, then checks the aggregate ratio. */
export function compress(zippable: Zippable): Uint8Array<ArrayBuffer> {
    let bytes = zipSync(zippable, { level: 6, mtime: ARCHIVE_MTIME });
    const sizes = zipEntrySizes(bytes);
    const tooCompressible = sizes.filter(entry => entry.uncompressed > MOD_ARCHIVE_RATIO_EXEMPT_ENTRY_BYTES
        && entry.uncompressed > entry.compressed * MOD_ARCHIVE_MAXIMUM_COMPRESSION_RATIO).map(entry => entry.name);
    if (tooCompressible.length > 0) {
        const stored: Zippable = { ...zippable };
        for (const name of tooCompressible) stored[name] = [zippable[name] as Uint8Array, { level: 0 }];
        bytes = zipSync(stored, { level: 6, mtime: ARCHIVE_MTIME });
    }
    const total = zipEntrySizes(bytes).reduce((sum, entry) => sum + entry.uncompressed, 0);
    if (total > MOD_ARCHIVE_RATIO_EXEMPT_TOTAL_BYTES && total > bytes.byteLength * MOD_ARCHIVE_MAXIMUM_COMPRESSION_RATIO) {
        throw new ModArchiveError("compression-ratio");
    }
    return bytes as Uint8Array<ArrayBuffer>;
}

/** Reads each entry's name and sizes from a ZIP's central directory (single disk, no comment, as fflate writes it). */
export function zipEntrySizes(bytes: Uint8Array): { name: string; compressed: number; uncompressed: number }[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = bytes.byteLength - 22;
    if (end < 0 || view.getUint32(end, true) !== 0x06054b50) throw new Error("Unexpected ZIP layout");
    const count = view.getUint16(end + 10, true);
    let offset = view.getUint32(end + 16, true);
    const decoder = new TextDecoder();
    const entries = [];
    for (let index = 0; index < count; index += 1) {
        if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("Unexpected ZIP layout");
        const nameLength = view.getUint16(offset + 28, true);
        entries.push({
            name: decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)),
            compressed: view.getUint32(offset + 20, true),
            uncompressed: view.getUint32(offset + 24, true),
        });
        offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    }
    return entries;
}

/** Returns the `value` of the root's single direct child element `name`, or null when absent or repeated. */
function singleValue(root: Element, name: string): string | null {
    const matches = childElements(root, name);
    return matches.length === 1 ? matches[0].getAttribute("value") : null;
}

/** Lists the root's direct child elements with this exact name. */
function childElements(root: Element, name: string): Element[] {
    return Array.from(root.children).filter(child => child.nodeName === name);
}

/** Reads a picked file as strict UTF-8 text; invalid encoding is a SubModule.xml problem. */
async function readText(file: ModFolderFile): Promise<string> {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    } catch {
        throw new ModArchiveError("submodule-invalid");
    }
}

/** Parses XML with the browser's parser. */
function defaultXmlParser(text: string): Document {
    return new DOMParser().parseFromString(text, "application/xml");
}
