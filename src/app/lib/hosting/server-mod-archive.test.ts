import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync } from "fflate";
import { JSDOM } from "jsdom";
import { buildModArchive, compress, ModArchiveError, zipEntrySizes, type ModArchiveProblem, type ModFolderFile } from "./server-mod-archive";

const parseXml = (text: string) => new new JSDOM().window.DOMParser().parseFromString(text, "application/xml");
const MIB = 1_048_576;

/** Builds a SubModule.xml body; pass `null` to omit a field. */
function submodule(fields: { id?: string | null; name?: string | null; version?: string | null; extra?: string } = {}) {
    const field = (tag: string, value: string | null | undefined, fallback: string) => value === null ? "" : `<${tag} value="${value ?? fallback}"/>`;
    return `﻿<?xml version="1.0" encoding="utf-8"?>\n<Module>${field("Name", fields.name, "Butter Lib")}${field("Id", fields.id, "Bannerlord.ButterLib")}${field("Version", fields.version, "v2.9.18")}${fields.extra ?? ""}<DependedModules><DependedModule Id="Native"/></DependedModules></Module>`;
}

/** Simulates picked files; `size` may be overridden to test bounds without allocating. */
function folder(entries: Record<string, string | Uint8Array>, sizes: Record<string, number> = {}): ModFolderFile[] {
    return Object.entries(entries).map(([path, content]) => {
        const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
        return { webkitRelativePath: path, size: sizes[path] ?? bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer };
    });
}

/** Asserts that building rejects with this problem. */
async function rejects(files: ModFolderFile[], problem: ModArchiveProblem) {
    await assert.rejects(buildModArchive(files, { parseXml }), (error: unknown) => error instanceof ModArchiveError && error.problem === problem, problem);
}

test("zips the picked folder under its SubModule.xml Id with the manifest the upload declares", async () => {
    const files = folder({
        "ButterLib-v2.9.18/SubModule.xml": submodule(),
        "ButterLib-v2.9.18/bin/Win64_Shipping_Client/Bannerlord.ButterLib.dll": new Uint8Array([1, 2, 3]),
        "ButterLib-v2.9.18/ModuleData/Languages/ru/strings.xml": "<strings/>",
    });
    const archive = await buildModArchive(files, { parseXml });
    assert.deepEqual(archive.manifest, { id: "Bannerlord.ButterLib", name: "Butter Lib", version: "v2.9.18" });
    assert.equal(archive.fileCount, 3);
    const entries = unzipSync(archive.bytes);
    assert.deepEqual(Object.keys(entries).sort(), [
        "Bannerlord.ButterLib/ModuleData/Languages/ru/strings.xml",
        "Bannerlord.ButterLib/SubModule.xml",
        "Bannerlord.ButterLib/bin/Win64_Shipping_Client/Bannerlord.ButterLib.dll",
    ]);
    assert.deepEqual([...entries["Bannerlord.ButterLib/bin/Win64_Shipping_Client/Bannerlord.ButterLib.dll"]], [1, 2, 3]);
    const again = await buildModArchive(folder({
        "ButterLib-v2.9.18/ModuleData/Languages/ru/strings.xml": "<strings/>",
        "ButterLib-v2.9.18/bin/Win64_Shipping_Client/Bannerlord.ButterLib.dll": new Uint8Array([1, 2, 3]),
        "ButterLib-v2.9.18/SubModule.xml": submodule(),
    }), { parseXml });
    assert.deepEqual(again.bytes, archive.bytes, "the same folder yields the same archive");
});

test("requires exactly one picked module folder with SubModule.xml at its top level", async () => {
    await rejects([], "no-folder");
    await rejects(folder({ "SubModule.xml": submodule() }), "no-folder");
    await rejects(folder({ "A/SubModule.xml": submodule(), "B/readme.txt": "x" }), "multiple-folders");
    await rejects(folder({ "Modules/ButterLib/SubModule.xml": submodule() }), "no-submodule");
    await rejects(folder({ "ButterLib/submodule.xml": submodule() }), "no-submodule");
    await rejects(folder({ "ButterLib/SubModule.xml": "x" }, { "ButterLib/SubModule.xml": MIB + 1 }), "submodule-invalid");
});

test("reads Id, Name and Version with the runner's rules", async () => {
    const cases: [string, ModArchiveProblem][] = [
        [submodule({ id: null }), "invalid-id"],
        [submodule({ id: "Bad/Id" }), "invalid-id"],
        [submodule({ id: "CoopNightly" }), "reserved-id"],
        [submodule({ id: "DedicatedServer.Windows" }), "reserved-id"],
        [submodule({ name: null }), "invalid-name"],
        [submodule({ name: " padded" }), "invalid-name"],
        [submodule({ version: null }), "invalid-version"],
        [submodule({ version: "v 1" }), "invalid-version"],
        [submodule({ extra: '<ModuleType value="Official"/>' }), "submodule-invalid"],
        [submodule({ extra: '<Official value="true"/>' }), "submodule-invalid"],
        [submodule({ extra: '<Id value="Second"/>' }), "invalid-id"],
        [`<!DOCTYPE Module>${submodule()}`, "submodule-invalid"],
        [submodule({ name: "Butter&#76;ib" }), "submodule-invalid"],
        ["<Module><Id value=\"x\"></Module>", "submodule-invalid"],
    ];
    for (const [xml, problem] of cases) await rejects(folder({ "ButterLib/SubModule.xml": xml }), problem);
    const invalidUtf8 = folder({ "ButterLib/SubModule.xml": new Uint8Array([0x3c, 0xff, 0xfe]) });
    await rejects(invalidUtf8, "submodule-invalid");
    const community = await buildModArchive(folder({ "ButterLib/SubModule.xml": submodule({ extra: '<ModuleType value="Community"/><Official value="false"/>' }) }), { parseXml });
    assert.equal(community.manifest.id, "Bannerlord.ButterLib");
});

test("enforces path, count and size bounds before reading file contents", async () => {
    const base = { "ButterLib/SubModule.xml": submodule() };
    await rejects(folder({ ...base, "ButterLib/bad\\name.dll": "x" }), "invalid-path");
    await rejects(folder({ ...base, "ButterLib/tab\tname.dll": "x" }), "invalid-path");
    await rejects(folder({ ...base, [`ButterLib/${"d/".repeat(15)}deep.txt`]: "x" }), "invalid-path");
    await rejects(folder({ ...base, [`ButterLib/${"n".repeat(230)}.txt`]: "x" }), "invalid-path");
    await rejects(folder({ ...base, "ButterLib/Readme.txt": "x", "ButterLib/README.txt": "y" }), "duplicate-path");
    await rejects(folder({ ...base, "ButterLib/café.txt": "x", "ButterLib/café.txt": "y" }), "duplicate-path");
    const many: Record<string, string> = { ...base };
    for (let index = 0; index < 5_000; index += 1) many[`ButterLib/f${index}.txt`] = "";
    await rejects(folder(many), "too-many-files");
    await rejects(folder({ ...base, "ButterLib/huge.bin": "x" }, { "ButterLib/huge.bin": 512 * MIB }), "too-large-uncompressed");
});

test("stores large entries that would exceed the compression ratio and refuses an aggregate bomb", () => {
    const zeros = new Uint8Array(2 * MIB);
    const stored = zipEntrySizes(compress({ "SomeMod/SubModule.xml": new TextEncoder().encode("<Module/>"), "SomeMod/zeros.bin": zeros }));
    const entry = stored.find(item => item.name === "SomeMod/zeros.bin")!;
    assert.equal(entry.uncompressed, 2 * MIB);
    assert.equal(entry.compressed, 2 * MIB, "stored rather than deflated past 100:1");
    const bomb: Record<string, Uint8Array> = {};
    for (let index = 0; index < 17; index += 1) bomb[`SomeMod/part${index}.bin`] = new Uint8Array(MIB);
    assert.throws(() => compress(bomb), (error: unknown) => error instanceof ModArchiveError && error.problem === "compression-ratio");
});
