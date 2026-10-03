# Cheats localization migration source

The authoritative website English messages are `src/app/lib/localization/dictionaries/en/cheats.json`. The route delivers only the `cheats` namespace through the shared `LocalizationProvider`; the root payload remains `common` only.

`zh-CN.json` is the complete, flat shared-runtime-shaped compatibility dictionary for existing `/cheats?lang=zh-CN` links and aliases (`zh`, `zh_hans`, `zh-hans-cn`, `cn`, case-insensitive, underscores accepted). It preserves the vetted UI/category translations from the former `en.ts` / `zh-CN.ts` modules and command descriptions/argument explanations from `zh-CN.commands.json` at foundation base `ef6af4f2f30e6a5d4786e5bceb4c47621f6ebb72`. Rich prose is now whole messages with named code slots. `ui.shown` uses numeric `count` for plural selection and `{formattedCount}` for locale-formatted output.

The Chinese language lane should copy this dictionary to its owned `src/app/lib/localization/dictionaries/zh-CN/cheats.json`, preserve exact keys/tokens, and review it alongside the other Chinese namespaces before activating its locale module. Once global Chinese is enabled, `getCheatsLocalization` loads the activated shared dictionary, not this compatibility snapshot. Other languages add only their own dictionary data and activation module; no cheats component edits are required.

Keys:

- `ui.*`: page/metadata/accessibility/filter/action/empty-state messages.
- `category.<lowercase_underscore_id>`: labels for the existing category URL identifiers.
- `command.<immutable-command-id>.summary`: translated command descriptions for display/search.
- `command.<immutable-command-id>.argument.<immutable-argument-name>`: argument explanatory prose.

Do not translate command names/identifiers, executable usage, argument names, category query values, code slots, or source metadata. Command names come directly from the catalog in English, matching the server; there are no command-name dictionary keys. Descriptions and argument explanations remain translated.

## Command presentation regression

| Path | Expected behavior | Focused coverage |
| --- | --- | --- |
| Non-English cheats page | English command names/syntax; translated descriptions and argument explanations | `locale.test.ts`, `CheatsDirectory.test.tsx`, `localization.component.test.tsx` |
| Server command reference | Catalog names/syntax; translated descriptions and search explanations | `ServerManagementWorkspace.component.test.tsx` |

## Retained catalog API and sync inputs

`../commands.json` and `zh-CN.commands.json` remain unchanged source snapshots because the existing `tools/cheats/sync.mjs` producer/tests and the separately owned server-console catalog consume them. Neither is a second runtime language preference or a display-message fallback. The preserved Chinese sync snapshot's name fields are not used for runtime presentation. Cheats components render descriptions and argument explanations via the shared translator; the server page strips catalog prose before client delivery and supplies English search text from the authoritative English dictionary only for translated views.

When repinning the command catalog, update English messages and the Chinese compatibility snapshot as well. `locale.test.ts` checks exact source extraction and Chinese snapshot coverage/parity, so stale dictionary prose cannot silently pass. The server-console owner is responsible for localizing its own presentation boundary without changing command syntax or operations. No sync-tool or server-console code is owned or changed by this seam.
