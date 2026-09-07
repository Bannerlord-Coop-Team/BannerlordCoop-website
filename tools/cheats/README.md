# Sync the cheats directory

Source: [BannerlordCoop PR #3538](https://github.com/Bannerlord-Coop-Team/BannerlordCoop/pull/3538), pinned at `4d030c26c49b271e77676179571e120698f42f52`.

Run from the website root with Git, Node.js 22+, and the .NET 10 SDK:

```sh
node tools/cheats/sync.mjs /path/to/BannerlordCoop 4d030c26c49b271e77676179571e120698f42f52
node tools/cheats/sync.mjs /path/to/BannerlordCoop 4d030c26c49b271e77676179571e120698f42f52 --check
node --test tools/cheats/sync.test.mjs
npx tsx --test src/app/cheats/locale.test.ts src/app/cheats/CheatsDirectory.test.tsx
```

The commit must already exist locally. These commands neither fetch nor check out nor modify the mod repository. They regenerate `src/app/cheats/commands.json` and `src/app/cheats/locales/zh-CN.commands.json`; `--check` compares without writing. CRLF checkouts are supported. Review the diff before publishing a newer pin.

## Extraction contract

Roslyn reads C# syntax from `git show <commit>:<path>`, not the working tree. It parses release code with `TRACE` defined and `DEBUG` undefined, and separately records DEBUG-only declarations. This avoids stale compiled DLLs, game dependencies, command constructors and static initializers. Reflection would require loading current mod/game assemblies and executing metadata getters; none of that is necessary for these declarative properties. Roslyn is referenced from the installed SDK, so there are no new npm or NuGet package dependencies.

At this pin, `GameInterfaceModule` and `MissionModule` scan their own assemblies for concrete `ICoopCommand` implementations. Both assemblies are included. `Coop.Core` explicitly registers connection commands only inside `#if DEBUG`, so it contributes no release commands. Both scanned projects use default C# source inclusion; command metadata uses only DEBUG conditionals.

This is a **bounded source extractor**, not a C# interpreter or generic MSBuild evaluator. Roslyn binds the pinned Common, GameInterface and Missions source types to find concrete classes whose transitive `AllInterfaces` includes `Common.Commands.ICoopCommand`, including marker interfaces in separate files, namespace imports and aliases. Common provides type definitions, not additional registrations. This restores `HeroIdCommand : IHeroIdCommand : ICoopCommand`; it is the only additional inherited concrete command found across both scanned assemblies at this pin. No assembly is emitted or loaded.

Metadata still must be declared on the concrete command: supported values are literals, enclosing string constants/concatenation, the three `CoopCommandSide` values, literal `ExpectedArgs` arrays, empty arrays, and parameterless expression-bodied argument factories. Ambiguous or unresolved source base types, cyclic inheritance, generic/partial command classes, inherited/missing metadata properties, unsupported expressions, duplicate names and non-snake-case command names fail the update. Unavailable external game types are not interpreted as command interfaces. Review the extractor before repinning if registration scopes, project source inclusions, external command-interface dependencies, preprocessor symbols or metadata declaration forms change. Tests exercise source binding and metadata declarations in temporary Git history without executing mod code.

`Prefix`, `Name`, `Description`, `Side`, argument names/descriptions/required flags, and source locations come from source. Usage follows `CoopCommandDescriptor.BuildUsage`: `<required>` and `[<optional>]`. Parameter names and enum values remain untranslated because they are executable syntax. `CoopCommandSide.Both` maps to the existing website's `either` query value, displayed as **Both / 两端皆可**. No old spelling is advertised as an executable alias. Source names such as `mobileparty` and `mapevent` that upstream still registers are preserved, not mechanically renamed.

Categories are editorial group mappings in `sync.mjs`. The existing inspect/action/audit UI classification is derived from the description's opening verb, not a runtime permission or mod-provided enum. Fixture-name exclusions preserve the website's existing publication rule (`fixture` in command/name); this is not a new blanket exclusion of all commands whose descriptions mention testing.

## Localization and validation

`zh-CN.json` is the reviewed English-to-Simplified-Chinese translation memory for exact descriptions and argument help. It is not machine-generated at sync time. Any new or changed source text without a translation aborts generation before either output is written. Some upstream descriptions are generic (for example, “Runs the … debug operation.”); the website now shows those actual descriptions, including on Featured, rather than overriding them with older behavioral claims. Update `featured.ts` and localized documentation examples explicitly if command names change.

Snapshot: **461 release registrations → 400 published commands**, excluding **61 fixture-named commands**. The scanned assemblies also contain **57 DEBUG-only declarations**, recorded as exclusions. There are **40 categories**, **446 argument entries** (180 distinct help strings), and complete Chinese coverage for all 400 commands. Sides: **131 Server, 65 Client, 204 Both**.

Relative to the previous 449-entry JSON, 186 old keys disappear and 137 new keys appear; many are snake-case migrations, and fixtures previously filtered only at render time are now omitted from the JSON too. Removed non-fixture keys without an equivalent spelling include `coop.debug.hero.change`, `getChange`, and `coop.debug.steam.join`/`status`. `coop.debug.hero.id` remains registered with the exact argument spelling `<heroName>`. Featured names, usage, examples and search use current registered keys only.

The checks cover source parsing, transitive interface discovery across files/assemblies, alias resolution, ambiguous/cyclic inheritance rejection, conditional exclusion, exact side extraction, constant/helper metadata, pinning versus dirty checkout, fail-closed unknown expressions, deterministic generation, translation coverage, rendered argument help, translated search, side filters and share-link round trips. Browser clipboard/game execution still need an interactive smoke test; no game commands are executed by the tests.
