import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { buildCatalog, buildTranslations } from "./sync.mjs";

const sample = (name, side = "Both", description = '"Description with \\"quotes\\"."', args = "System.Array.Empty<IExpectedArgs>()") => `
public sealed class ${name}Command : ICoopCommand {
    public string Prefix => "coop.debug.hero";
    public string Name => "${name}";
    public string Description => ${description};
    public CoopCommandSide Side => CoopCommandSide.${side};
    public IExpectedArgs[] ExpectedArgs { get; } = ${args};
    public CoopCommandResult ProcessCommand(ICoopCommandArgs args) => throw new Exception("Must not execute");
}`;

// Temporary Git history proves extraction reads the requested commit, not the working tree.
test("Roslyn extractor resolves inherited interfaces and respects release directives, metadata and pinned history", () => {
    execFileSync("dotnet", ["build", "tools/cheats", "--nologo"], { stdio: "pipe" });
    const repo = mkdtempSync(join(tmpdir(), "cheats-extract-test-"));
    const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
    try {
        mkdirSync(join(repo, "source/Common"), { recursive: true });
        writeFileSync(join(repo, "source/Common/Contract.cs"), "global using Common.Commands; namespace Common.Commands { public interface ICoopCommand {} }");
        mkdirSync(join(repo, "source/GameInterface"), { recursive: true });
        mkdirSync(join(repo, "source/Missions"), { recursive: true });
        git("init");
        git("config", "user.name", "Cheats test");
        git("config", "user.email", "cheats@example.invalid");
        const sourcePath = join(repo, "source/GameInterface/Commands.cs");
        const source = `/* ${sample("commented")} */
#if DEBUG
${sample("debug_only")}
#else
public class Outer {
    private const string Help = "Constant " + "description.";
    private static IExpectedArgs[] Pair() => new IExpectedArgs[] {
        new ExpectedArgs("hero_id", "Registered id."),
        new ExpectedArgs("name", "Quoted name.", isRequired: false),
    };
    ${sample("release", "Server", "Help", "Pair()")}
}
#endif
${sample("both")}`;
        writeFileSync(sourcePath, source);
        writeFileSync(join(repo, "source/Missions/Commands.cs"), sample("client", "Client"));
        git("add", ".");
        git("commit", "-m", "metadata fixture");
        const commit = git("rev-parse", "HEAD");
        const extract = sha => JSON.parse(execFileSync("dotnet", [resolve("tools/cheats/bin/Debug/net10.0/ExtractCommands.dll"), repo, sha], { encoding: "utf8", stdio: "pipe" }));
        writeFileSync(sourcePath, "invalid local contents");
        const raw = extract(commit);
        assert.deepEqual(raw.commands.map(c => c.name), ["release", "both", "client"]);
        assert.deepEqual(raw.commands.map(c => c.side), ["server", "either", "client"]);
        assert.deepEqual(raw.debugOnly, ["coop.debug.hero.debug_only"]);
        assert.equal(raw.commands[0].summary, "Constant description.");
        assert.deepEqual(raw.commands[0].arguments.map(a => a.required), [true, false]);
        assert.equal(raw.commands[1].summary, 'Description with "quotes".');
        assert.deepEqual(extract(commit), raw);

        writeFileSync(sourcePath, source);
        // Neither implementation directly names ICoopCommand in its base list; bind across files.
        writeFileSync(join(repo, "source/Common/Markers.cs"), "namespace Markers { public interface IFirst : Common.Commands.ICoopCommand {} public interface ISecond : IFirst {} }");
        writeFileSync(join(repo, "source/GameInterface/Inherited.cs"), sample("inherited").replace(": ICoopCommand", ": Markers.ISecond"));
        writeFileSync(join(repo, "source/Missions/Inherited.cs"), 'using MarkerAlias = Markers.ISecond;\n' + sample("inherited_mission").replace(": ICoopCommand", ": MarkerAlias") + '\n#if DEBUG\n' + sample("inherited_debug").replace(": ICoopCommand", ": MarkerAlias") + "\n#endif");
        git("add", "."); git("commit", "-m", "transitive inherited interfaces across assemblies");
        const inherited = extract(git("rev-parse", "HEAD"));
        assert.deepEqual(inherited.commands.map(c => c.name), ["release", "both", "inherited", "client", "inherited_mission"]);
        assert.deepEqual(inherited.debugOnly, ["coop.debug.hero.debug_only", "coop.debug.hero.inherited_debug"]);
        writeFileSync(join(repo, "source/GameInterface/Inherited.cs"), 'using First; using Second;\n' + sample("inherited").replace(": ICoopCommand", ": IMarker") + '\nnamespace First { public interface IMarker : Common.Commands.ICoopCommand {} } namespace Second { public interface IMarker : Common.Commands.ICoopCommand {} }');
        git("add", "."); git("commit", "-m", "ambiguous inherited interface");
        assert.throws(() => extract(git("rev-parse", "HEAD")), /ambiguous source base type/);
        writeFileSync(join(repo, "source/GameInterface/Inherited.cs"), 'public interface ICycle : IOther {} public interface IOther : ICycle, ICoopCommand {}');
        git("add", "."); git("commit", "-m", "cyclic inheritance");
        assert.throws(() => extract(git("rev-parse", "HEAD")), /Cyclic source inheritance/);
        writeFileSync(join(repo, "source/GameInterface/Inherited.cs"), sample("inherited").replace("inheritedCommand :", "inheritedCommand<T> :"));
        git("add", "."); git("commit", "-m", "unsupported generic command");
        assert.throws(() => extract(git("rev-parse", "HEAD")), /Unsupported generic or partial command/);
        writeFileSync(join(repo, "source/GameInterface/Inherited.cs"), "");
        writeFileSync(sourcePath, sample("unsupported", "Unknown"));
        git("add", "."); git("commit", "-m", "unsupported side");
        assert.throws(() => extract(git("rev-parse", "HEAD")), /Unsupported Side/);
        writeFileSync(sourcePath, sample("unsupported", "Both", "RuntimeDescription()"));
        git("add", "."); git("commit", "-m", "unsupported expression");
        assert.throws(() => extract(git("rev-parse", "HEAD")), /Unsupported metadata expression/);
        writeFileSync(sourcePath, sample("client").replace("class clientCommand", "class DuplicateClientCommand"));
        git("add", "."); git("commit", "-m", "duplicate name");
        assert.throws(() => extract(git("rev-parse", "HEAD")), /Duplicate command/);
        writeFileSync(sourcePath, sample("unsupported", "Both", '"Description."', 'new IExpectedArgs[] { new ExpectedArgs("value", "Help.", IsRequired()) }'));
        git("add", "."); git("commit", "-m", "unsupported required expression");
        assert.throws(() => extract(git("rev-parse", "HEAD")), /coop.debug.hero.unsupported/);
    } finally {
        rmSync(repo, { recursive: true, force: true });
    }
});

test("catalog generation applies publication rules, exact usages, counts and translation fail-closed", () => {
    const command = { command: "coop.debug.hero.list", name: "list", group: "coop.debug.hero", summary: "Lists heroes.", side: "either", arguments: [{ name: "prefix", description: "Optional prefix.", required: false }] };
    const raw = { commit: "abc", commands: [command, { ...command, name: "fixture", command: "coop.debug.hero.fixture" }], debugOnly: ["coop.debug.hero.debug_only"] };
    const catalog = buildCatalog(raw);
    assert.equal(catalog.count, 1);
    assert.equal(catalog.source.registeredCount, 2);
    assert.equal(catalog.source.excludedFixtureCount, 1);
    assert.equal(catalog.commands[0].usage, "coop.debug.hero.list [<prefix>]");
    assert.deepEqual(catalog.commands[0].aliases, []);
    assert.throws(() => buildTranslations(catalog, {}), /Missing zh-CN translation/);
    const zh = buildTranslations(catalog, { "Lists heroes.": "列出英雄。", "Optional prefix.": "可选前缀。" });
    assert.equal(zh[command.command].arguments.prefix, "可选前缀。");
});

test("checked-in locale output is generated from exact current source descriptions", () => {
    const catalog = JSON.parse(readFileSync("src/app/cheats/commands.json", "utf8"));
    const translations = JSON.parse(readFileSync("tools/cheats/zh-CN.json", "utf8"));
    const overlays = JSON.parse(readFileSync("src/app/cheats/locales/zh-CN.commands.json", "utf8"));
    assert.deepEqual(buildTranslations(catalog, translations), overlays);
});
