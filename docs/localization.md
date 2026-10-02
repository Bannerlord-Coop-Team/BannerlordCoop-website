# Website localization contract

## Scope and identifiers

English (`en`) is the default. The independently activated locales are Simplified Chinese (`zh-CN`), Russian (`ru`), neutral Spanish (`es`), Brazilian Portuguese (`pt-BR`), European Portuguese (`pt-PT`), Japanese (`ja`), and Korean (`ko`). Never infer language from browser headers, geography, or browser settings. Preserve existing routes and auth callbacks. Admin-only pages and controls are excluded; ordinary-user account and server management are included.

## Runtime API and dictionary format

The dependency-free runtime lives in `src/app/lib/localization`. Server callers use async `getLocale()` and `getTranslations(namespace)`; client callers use `useTranslations(namespace)`. Both expose `t(key, params?)`, `rich(key, slots)`, `locale`, `number(value, options?)`, and `date(value, options?)`. `params.count` selects a plural category with `Intl.PluralRules`. Rich values are React nodes in named `{slot}` placeholders, never parsed HTML; React escapes interpolated text. Use complete grammatical messages that translators can reorder, not translated sentence fragments.

Authoritative English data lives in `src/app/lib/localization/dictionaries/en/<namespace>.json`. Each file is a flat semantic-key object. Values are strings or plural objects with CLDR category keys and mandatory `other`. Named `{tokens}` must survive translation. Plural translations may use locale-specific categories, preserving tokens in every form. No functions, executable code, HTML, or user-supplied values in dictionaries.

Root delivery includes only `common`, not every page's messages. Page-scoped provider composition delivers required client namespaces, especially the large cheats dictionary, without importing server loaders into client modules. Server components resolve dictionaries directly. Shared UI such as DownloadModal uses `common` and works outside the home route. Server imports from `@/app/lib/localization/server`: `getLocale(): Promise<Locale>`, `getMessages(namespaces: readonly Namespace[], locale?: Locale): Promise<Messages>`, `getTranslations(namespace: Namespace, locale?: Locale): Promise<Translator>`, and `getOpenGraphLocale(): Promise<string>`. Client imports from `@/app/lib/localization/client`: `LocalizationProvider({ locale, messages, enabledLocales?, children })`, `useTranslations(namespace): Translator`, and `useLocalization()` (root locale/options). Nested providers compose namespaces and retain the parent's common locale. Pages deliver only their required namespaces using `getMessages`; loaders/registry are server-only. Pure `createTranslator(locale, dictionary)` comes from `translator.tsx`; shared types come from `types.ts`. Translator methods are `t(key, params?: Record<string, string | number>): string`, `rich(key, slots: Record<string, ReactNode>): ReactNode`, `number(value, options?: Intl.NumberFormatOptions): string`, and `date(value: Date | number | string, options?: Intl.DateTimeFormatOptions): string`. Dates default to UTC for SSR/client consistency. Missing messages/tokens throw rather than concealing incomplete enabled dictionaries. Standalone client tests must provide required namespaces. The account page should pass a translated fallback to `accountDisplayName(user, fallback)`; actual display names remain unchanged.

One cookie, `blcoop-locale`, remembers explicit selections (`path=/`, `SameSite=Lax`, one-year lifetime). Await Next's asynchronous cookie API. The root HTML lang, root provider, and server metadata resolve from that cookie. Invalid or disabled global locales resolve to English. Accessible desktop/mobile selectors show only enabled locales, and persist via a server action. Selection preserves pathname, other query parameters, hash, and authentication behavior.

Each `locales/<locale>.ts` independently owns activation and imports only its locale's dictionaries. Foundation registers all modules once, initially disabled except English. Language PRs change only their own dictionary directory and activation file, never shared registry or page code. Enabled dictionaries must pass exact namespace/key and placeholder checks; do not hide incomplete translations behind English fallback.

### Existing Chinese cheats compatibility

`/cheats?lang=zh-CN` and existing Chinese aliases remain explicit cheats-content overrides while global Chinese is disabled. Resolve overrides in the cheats page and its metadata; apply content-scoped lang. Site chrome still follows the shared cookie. Keep existing vetted Chinese command translations for migration by the Chinese lane. Remove the old cheats selector and localStorage/cookie preference writes. Do not introduce a localization proxy or redirect bridge. Changing the site selector on a cheats URL must update or remove `lang` to match the new selection while preserving all filters/query/hash. Without an override, cheats follows the global locale; explicit share links remain supported after activation.

## Exclusive namespace and source ownership

The foundation is multi-seam. Each worker owns an isolated worktree; the foundation orchestrator owns integration and this document, not page implementation. Associated focused tests belong to the source owner. All paths below are under `src/app` unless fully specified.

| Entry / namespace | Exclusive foundation source owner |
| --- | --- |
| shared / `common` | runtime: `layout.tsx`, `loading.tsx`, `components/layout/*`, `components/ui/*`, `components/home/modulesection/DownloadModal.tsx`, all localization runtime files and scaffolding (not completed page dictionary contents); `lib/auth/account-display.ts` optional translated fallback and focused helper test (preserve default English and user metadata precedence) |
| home `/` / `home` | home: `page.tsx`, `components/home/**` except DownloadModal, `lib/roadmap.ts`; `lib/youtube.ts` and directly affected homepage-media helpers/types/tests for injected generated fallback/thumbnail labels (preserve external content and fetch/cache semantics); narrow additive `supabase/migrations` migration assigning nullable stable translation keys to known roadmap milestone/item seed prose, with focused migration tests |
| account `/account` / `account` | account: `account/**` including account action presentation |
| changelog `/changelog` / `changelog` | changelog: `changelog/**`; external release bodies remain source text |
| cheats `/cheats` / `cheats` | cheats: `cheats/**`, all published command names/descriptions/argument prose and categories, existing Chinese compatibility data |
| login `/login` / `login` | login: `login/**`, `components/auth/LoginForm.tsx`, `auth/callback/route.ts` website fallback only when provider `error_description` is absent, `lib/supabase/client.ts` optional injected configuration-error text and focused tests; preserve raw provider errors, singleton/auth behavior, redirect/query/error semantics |
| servers `/servers` / `servers` | servers: `servers/page.tsx`, `servers/loading.tsx`, `servers/onboarding-actions.ts`, `components/servers/{AllServersDirectory,ServerDirectoryTable,ServerOnboarding,MembershipNextStep}.tsx` |
| managed-server `/servers/[serverId]` / `managed-server`, `server-common` | managed-server: `servers/[serverId]/**`, `components/servers/ManagedServer*.tsx`, `components/servers/{ServerControlPanel,ServerSettingsPanel,ServerSaveConfigPanels,ServerVisibilitySetting,ServerManagementWorkspace,EditableServerName,CopyJoinButton,DownloadServerLogButton}.tsx`, `components/servers/managed-server-backup-policy.ts`, `servers/managed-server-*.ts`, `servers/{name-actions,server-release-actions,server-settings-actions,server-visibility-actions}.ts`, user-facing parts of `lib/control-plane/{presentation,explanations}.ts` through injected translator/default-English compatibility rather than changing admin behavior; `lib/hosting/server-names.ts` optional injected validation messages and focused tests (same rules/result/default English); `lib/console/access.ts:getLiveConsoleMember` optional missing-name/email labels and focused tests (same identity precedence/coercion/access behavior) |
| live-server `/servers/live/[serverId]` / `live-server` | live-server: preserve legacy route redirect to unified manage, own its compatibility test; `components/servers/LiveServer*.tsx`, `components/servers/Ionos*.tsx`, `servers/{actions,access-actions}.ts`. Live UI is actually rendered by unified manage; provider there includes live-server and server-common. |
| server-wireframe `/servers/wireframe` / `server-wireframe` | wireframe: `servers/wireframe/**`; explicitly public interactive UI |
| support `/support` / `support` | support: `support/**` |
| not-found / `not-found` | not-found: `not-found.tsx` and focused test |

Shared server namespaces have one extraction owner. The servers directory and unified manage pages both deliver `server-common`; unified manage also delivers `live-server` and `cheats`. Reuse cheats keys `command.<identifier>.name`, `command.<identifier>.summary`, `command.<identifier>.argument.<argument-name>` and category keys from its authoritative dictionary for command-reference presentation; do not duplicate prose in managed-server. Pure helper injections must remain request-independent. The unified page supplies localized missing-member labels to `getLiveConsoleMember`. Pure hosting/auth/transport helpers retain operational values and behavior. Where helpers produce website-owned labels, translate at the presentation boundary or inject the translator without importing request state into pure logic. Do not translate admin-only fields. If an unlisted shared source needs edits, ask the orchestrator to assign exclusive ownership first.

For later language PRs there is one worker for each of the eleven page entries. The home translator also owns `common`; managed-server owns `server-common`. No other worker duplicates these dictionaries.

## Immutable values

Do not translate Bannerlord Coop, Mount & Blade II: Bannerlord, product/brand names, command identifiers, argument names or executable syntax, URLs, IDs, user/server names, server logs, save/file payloads, or user-authored values. Checked-in website prose and command explanatory prose are translated. Live externally authored release bodies, video titles, and community content remain source content; localize surrounding labels and date/number formatting. Keep rich token names and interpolation placeholders exact. Preserve operation codes, form field values, authorization checks, error codes, and all authentication/payment/server-operation behavior.

## Focused behavior matrix

| Input / action | Required outcome |
| --- | --- |
| No cookie, invalid cookie, disabled global locale | English page, HTML lang, metadata, and hydration agree |
| Explicit enabled selection, then navigation/reload | Selection remains; no browser-language detection |
| Desktop/mobile keyboard selection | Accessible named select controls work, persist selection, and agree |
| Locale change on route with query/hash | Same route/filter/hash and auth callbacks preserved |
| Cheats Chinese alias/deep link | Chinese cheats content and metadata preserved; root chrome follows cookie |
| Selector change from Chinese cheats override | Stale override cannot defeat selection; filters/command target retained |
| Enabled dictionary with missing/extra key or changed token | Focused parity test fails |
| Locale plural categories/rich slots | Whole messages reorder safely; correct Intl plural/number/date formatting |
| Localized account/server action presentation | Authorization and operation inputs/results retain behavior |

Run only localization unit/component tests and directly affected existing page/action tests. Never run full test/build/lint/typecheck locally. Targeted checkpoint commands and evidence are recorded below; full foundation acceptance remains pending.

## Integration and publication

Runtime worker commits first and returns a durable API/test handoff. Page workers fast-forward their separate worktrees to that runtime baseline, implement only owned files, run focused tests, and commit. Orchestrator reads all actual outputs, integrates commits, checks English regression/coverage and dictionary integrity, then freezes this contract for data-only language lanes. Record every retained output reference. Obtain master approval for the exact foundation SHA/diff/tests before pushing only `feature/localization-foundation` and opening one unmerged PR against `main`. Language PRs target the foundation branch and independently activate themselves; no merges or deployments.


## Preserved implementation checkpoint

Shared runtime/common and five reviewed page seams (changelog, cheats, servers directory, support, not-found) are integrated. Home, account, unified managed server/server-common remain incomplete; login/live/wireframe partial commits remain in their isolated worktrees, not integrated. No locale translations are enabled and no foundation publication is approved.

**Full roadmap localization is user-approved.** Home owns an additive migration introducing nullable stable translation-key fields on `roadmap_milestones` and `roadmap_items`, assigning explicit semantic identities to all known checked-in website-authored seed prose. Preserve row IDs, original prose, statuses, ordering, and RLS/access policies; never rewrite historical migrations or use environment-specific UUIDs as message identities. English translations live in `home`; loaders/renderers consume explicit row keys, never runtime source-text replacement maps. Unkeyed/new live rows retain source prose until an editor assigns a corresponding dictionary key. Deployment must apply this migration before code; no production application is authorized here. Ongoing prose edits require updating the corresponding English and enabled-locale dictionary messages, and assigning keys for new translated rows. No admin editor or generic CMS infrastructure is in scope. Focused tests cover mapped content, unkeyed preservation, and migration preservation of identities/order/status.

The remaining six page lanes use only `website-localization-leaf` in isolated retained worktrees. Native internal workflows run with user-approved `async:false`; actual blocked leaf reports return to the coordinator without live questions. Preserve original partial commits, integrate each owned patch once, and validate shared consumers after integration.

Coordinator reviewed each of the five READY production diffs and owned file lists against this contract and consumed every page's actual handoff/evidence. No concrete ownership/scope blocker was found for those five commits. This is bounded integration review, not final independent foundation acceptance.

Verified shared baseline at `ef6af4f2` (8 files / 33 tests passed):

```sh
npx --no-install vitest run src/app/lib/localization/runtime.component.test.tsx src/app/components/layout/LocaleSelector.component.test.tsx src/app/components/layout/Navbar.component.test.tsx src/app/components/layout/CommunityDropdown.component.test.tsx src/app/components/layout/ProfileDropdown.component.test.tsx src/app/components/ui/loading.component.test.tsx src/app/components/home/modulesection/DownloadModal.component.test.tsx src/app/lib/auth/account-display.component.test.tsx
```

Verified combined runtime + integrated page seams (11 files / 131 tests passed):

```sh
npx --no-install vitest run src/app/lib/localization/runtime.component.test.tsx src/app/components/layout/LocaleSelector.component.test.tsx src/app/changelog/page.component.test.tsx src/app/cheats/localization.component.test.tsx src/app/servers/onboarding-page.component.test.tsx src/app/servers/onboarding-actions.component.test.tsx src/app/components/servers/ServerOnboarding.component.test.tsx src/app/components/servers/MembershipNextStep.component.test.tsx src/app/components/servers/AllServersDirectory.component.test.tsx src/app/support/page.component.test.tsx src/app/not-found.component.test.tsx
```

Verified cheats/catalog/Chinese parity and directory table regressions (14 tests passed):

```sh
npx --no-install tsx --test src/app/cheats/locale.test.ts src/app/cheats/CheatsDirectory.test.tsx src/app/components/servers/ServerDirectoryTable.test.tsx
git diff --check
```

Counts overlap shared runtime tests; do not sum them as unique coverage. Commands run locally are explicit targeted files, not a full suite/build/lint/typecheck. Future continuation must recheck directory/shared consumers after managed-server integration. Full run/commit/artifact/failure evidence is retained in the master foundation handoff; this checkpoint does not claim browser E2E, visual, production transport, full compilation, native proofreading, or completed ordinary-user coverage.
