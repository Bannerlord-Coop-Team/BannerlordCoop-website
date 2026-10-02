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
| home `/` / `home` | home: `page.tsx`, `components/home/**` except DownloadModal, `lib/roadmap.ts`; `lib/youtube.ts` and directly affected homepage-media helpers/types/tests for injected generated fallback/thumbnail labels (preserve external content and fetch/cache semantics); narrow additive `supabase/migrations` migrations assigning nullable stable translation keys to known roadmap milestone/item seed prose and the three website-authored editorial fields on the known Twitch homepage-video seed, with focused migration tests |
| account `/account` / `account` | account: `account/**` including account action presentation |
| changelog `/changelog` / `changelog` | changelog: `changelog/**`; external release bodies remain source text |
| cheats `/cheats` / `cheats` | cheats: `cheats/**`, all published command descriptions/argument prose and categories; command names stay in source English, existing Chinese compatibility data |
| login `/login` / `login` | login: `login/**`, `components/auth/LoginForm.tsx`, `auth/callback/route.ts` website fallback only when provider `error_description` is absent, `lib/supabase/client.ts` optional injected configuration-error text and focused tests; preserve raw provider errors, singleton/auth behavior, redirect/query/error semantics |
| servers `/servers` / `servers` | servers: `servers/page.tsx`, `servers/loading.tsx`, `servers/onboarding-actions.ts`, `components/servers/{AllServersDirectory,ServerDirectoryTable,ServerOnboarding,MembershipNextStep}.tsx` |
| managed-server `/servers/[serverId]` / `managed-server`, `server-common` | managed-server: `servers/[serverId]/**`, `components/servers/ManagedServer*.tsx`, `components/servers/{ServerControlPanel,ServerSettingsPanel,ServerSaveConfigPanels,ServerVisibilitySetting,ServerManagementWorkspace,EditableServerName,CopyJoinButton,DownloadServerLogButton}.tsx`, `components/servers/managed-server-backup-policy.ts`, `servers/managed-server-*.ts`, `servers/{name-actions,server-release-actions,server-settings-actions,server-visibility-actions}.ts`, user-facing parts of `lib/control-plane/{presentation,explanations}.ts` through injected translator/default-English compatibility rather than changing admin behavior; `lib/hosting/server-names.ts` optional injected validation messages and focused tests (same rules/result/default English); `lib/console/access.ts:getLiveConsoleMember` optional missing-name/email labels and focused tests (same identity precedence/coercion/access behavior) |
| live-server `/servers/live/[serverId]` / `live-server` | live-server: preserve legacy route redirect to unified manage, own its compatibility test; `components/servers/LiveServer*.tsx`, `components/servers/Ionos*.tsx`, `servers/{actions,access-actions}.ts`. Live UI is actually rendered by unified manage; provider there includes live-server and server-common. |
| server-wireframe `/servers/wireframe` / `server-wireframe` | wireframe: `servers/wireframe/**`; explicitly public interactive UI |
| support `/support` / `support` | support: `support/**` |
| not-found / `not-found` | not-found: `not-found.tsx` and focused test |

Shared server namespaces have one extraction owner. The servers directory and unified manage pages both deliver `server-common`; unified manage also delivers `live-server` and `cheats`. Keep catalog command names in English; reuse cheats keys `command.<identifier>.summary`, `command.<identifier>.argument.<argument-name>` and category keys from its authoritative dictionary for command-reference presentation; do not duplicate prose in managed-server. Managed-server additionally owns optional localized-message injection in `lib/hosting/server-files.ts:downloadMyServerLog`, `supabase/functions/_shared/server-log-contract.ts:serverLogDownloadHeaders`, and `supabase/functions/_shared/managed-server-configuration.ts:parseManagedServerConfiguration` plus its validation helpers and focused tests. This ownership also includes `supabase/functions/_shared/configuration-file-import.ts` (`readConfigurationFile`, `parseConfigurationImport`, `applyConfigurationImport`, and diagnostic-producing validators) for the same optional message injection; preserve parser/import results, ignored-value privacy, and default English. Preserve detailed diagnostics, default English, parser results, validation rules, transport/security checks, and all non-website callers; no generic-error replacement or source-text matching. Managed also owns `lib/hosting/my-servers.ts:myServersEndpoint` optional diagnostics (`notConfigured`, `invalidUrl`, `invalidKey`) and `lib/hosting/my-servers-presentation.component.test.tsx`, preserving error codes and endpoint/security checks; `ServerLogDownloadMessages.endpoint` threads these messages. Master additionally assigns managed-server optional injected website-authored user-visible messages in directly used pure management helpers under the same constraints. Inventory these transitive diagnostic seams together, preserve exclusive existing owners, and do not introduce generic error infrastructure. These are pure presentation injections, not schema/operation changes. Pure helper injections must remain request-independent. The unified page supplies localized missing-member labels to `getLiveConsoleMember`. Pure hosting/auth/transport helpers retain operational values and behavior. Where helpers produce website-owned labels, translate at the presentation boundary or inject the translator without importing request state into pure logic. Do not translate admin-only fields. If an unlisted shared source needs edits, ask the orchestrator to assign exclusive ownership first.

For later language PRs there is one worker for each of the eleven page entries. The home translator also owns `common`; managed-server owns `server-common`. No other worker duplicates these dictionaries.

## Immutable values

Do not translate Bannerlord Coop, Mount & Blade II: Bannerlord, product/brand names, command names/identifiers, argument names or executable syntax, URLs, IDs, user/server names, server logs, save/file payloads, or user-authored values. Checked-in website prose and command explanatory prose are translated. Live externally authored release bodies, video titles, and community content remain source content; localize surrounding labels and date/number formatting. Keep rich token names and interpolation placeholders exact. Preserve operation codes, form field values, authorization checks, error codes, and all authentication/payment/server-operation behavior.

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

Run only localization unit/component tests and directly affected existing page/action tests. Never run full test/build/lint/typecheck locally. Targeted integrated commands and independent review evidence are recorded below.

## Integration and publication

Runtime worker commits first and returns a durable API/test handoff. Page workers fast-forward their separate worktrees to that runtime baseline, implement only owned files, run focused tests, and commit. Orchestrator reads all actual outputs, integrates commits, checks English regression/coverage and dictionary integrity, then freezes this contract for data-only language lanes. Record every retained output reference. Obtain master approval for the exact foundation SHA/diff/tests before pushing only `feature/localization-foundation` and opening one unmerged PR against `main`. Language PRs target the foundation branch and independently activate themselves; no merges or deployments.


## Completed foundation and translation handoff

All eleven page entries and the shared runtime are integrated. English is the only enabled global locale; seven independent language branches supply data and activate themselves after completion. Existing Chinese cheats deep links remain supported. Explicit locale-specific cheats shares and metadata include `lang=en` for English; bare navigation follows the cookie.

Initial base was `d0bbf5c78c32e3b92a1071c72b7bae4c54f51883`. The approved main snapshot `a8ed3ede0d906f560618811f696443f02ff1428a` was subsequently merged non-destructively at `74661998d1cf5743c755f144f515e120bc712f49`: #235 runner diagnostic groups/reload semantics are preserved and localized; #236 is byte-identical to main. Do not infer authorization to deploy or merge this PR.

### Frozen dictionary inventory

There are **2,428 messages in 13 English namespaces**. Each later locale supplies exactly these namespaces/keys and preserves message kinds, tokens and rich slots. One home translator owns both home/common; one managed translator owns managed-server/server-common; the other nine page translators own their named namespace only.

| Namespace | Keys | Data owner |
| --- | ---: | --- |
| common | 49 | home translator |
| home | 154 | home translator |
| account | 45 | account |
| changelog | 25 | changelog |
| cheats | 933 | cheats |
| login | 27 | login |
| servers | 133 | servers |
| managed-server | 664 | managed-server |
| server-common | 49 | managed-server |
| live-server | 170 | live-server |
| server-wireframe | 137 | server-wireframe |
| support | 35 | support |
| not-found | 7 | not-found |

Add `dictionaries/<locale>/<namespace>.json`; populate that locale's existing `locales/<locale>.ts` lazy namespace imports and set `enabled: true` only after all thirteen dictionaries pass `runtime.component.test.tsx`. No shared registry/page rewrites. Chinese translators should consult `cheats/locales/zh-CN.json` and its README for vetted legacy catalog prose; the completed locale's authoritative data still belongs under its localization dictionary directory. Do not claim native proofreading unless performed. Preserve newline segmentation used by home headlines and all named rich slots. Command syntax, product names and user/source values remain immutable.

### Deployed-content migration and maintenance

**Apply both additive migrations before deploying the new loaders**, through a separately authorized deployment process:

1. `20261002150000_roadmap_translation_keys.sql`: nullable `title_translation_key` on milestones/items and `description_translation_key` on items. Maps all checked-in roadmap prose: 4 milestone titles, 39 item titles, 3 nonempty descriptions. Semantic keys are in home; no environment-specific UUID identities.
2. `20261002160000_homepage_video_translation_keys.sql`: nullable `description_translation_key`, `thumbnail_alt_translation_key`, `category_translation_key` on homepage videos. Maps three unchanged website-authored editorial fields at the known Twitch seed URL; preserves the external French title, creator/platform names, URLs, thumbnail and duration.

Both migrations preserve original IDs, prose, relationships, statuses, ordering, publication values, RLS and access policies. Assignment guards leave edited/unmatched content unkeyed. Loaders carry explicit keys; rendering translates keyed fields, never matches English text at runtime. Unkeyed/new live rows remain visible as source prose, including identical unkeyed text. Invalid assigned keys fail under the strict dictionary contract. Migration tests use disposable in-memory PGlite only; **no production schema or data was accessed/applied**. Deploying code before schema can trigger the loaders' existing unavailable-data paths.

For new translated content, first add semantic messages to English and every enabled locale, validate and deploy dictionaries, then assign those keys via a separately authorized trusted content workflow. For edits to keyed content, update corresponding dictionary messages and retained source fields; editing source alone does not update translated presentation. Clear a field's key if current source must display before translations are ready. No automatic translation of future database edits, new editor feature or generic CMS is promised.

### Injected presentation APIs

Pure helpers remain cookie/request-independent and preserve default English and operational behavior. Website callers supply translated messages:

- `accountDisplayName(user, fallback?)`; `getSupabaseBrowserClient(configurationError?)`.
- `getYouTubeVideos(urls, labels?)` and `getHomepageVideos(labels?)`: generated fallback title and thumbnail-label functions only; explicit media editorial keys are resolved by CommunityMedia outside network-error handling.
- `validateServerDisplayName(value, messages?)`; `getLiveConsoleMember(user, { missingName, missingEmail }?)`; `releaseChannelLabel(channel, labels?)`; `restoreDisabledReason(backup, messages?)`.
- `myServersEndpoint(messages?)`; `downloadMyServerLog(token, serverId, messages?)`; `serverLogDownloadHeaders(headers, invalidMessage?)`.
- `parseManagedServerConfiguration(value, messages?)` and configuration-import read/parse/apply optional diagnostic messages, including nested parser messages. `servers/managed-server-messages.ts` creates these message objects from injected `Translator.t`, not request state.

Unified management delivers managed-server/server-common/live-server/cheats; directory delivers servers/server-common. Actual logs, transport/provider errors, user names, files/configuration payloads and external media/release text remain source data. Admin-only controls remain excluded. All known accepted backup type labels are dictionary-backed. Legacy live route remains a redirect to unified management.

## Targeted acceptance evidence

Three independent read-only source reviews covered all owned runtime/page/helper seams on `a9b5575`. Four concrete findings were fixed: seeded Twitch editorial fields, six accepted backup labels, nine async Server Component fixture failures, and English cheats share metadata/links. Affected-only independent re-review passed at `9ebd5be4d22eecee2690eabdfa4f4d7dfeda60a2` (87 component + 15 node tests). Subsequent independent #235 overlap review passed at `74661998d1cf5743c755f144f515e120bc712f49` (16 focused tests); #236 committed blobs equal approved main.

Coordinator independently reran integrated shared/provider/helper consumers at `74661998`: **14 explicit component files / 135 tests passed**:

```sh
npx --no-install vitest run src/app/lib/localization/runtime.component.test.tsx src/app/components/layout/LocaleSelector.component.test.tsx src/app/components/home/home-localization.component.test.tsx src/app/lib/homepage-media.component.test.tsx src/app/cheats/localization.component.test.tsx 'src/app/servers/[serverId]/page.component.test.tsx' 'src/app/servers/[serverId]/page-files.component.test.tsx' src/app/components/servers/ManagedServerLocalization.component.test.tsx src/app/components/servers/LiveServerLocalization.component.test.tsx src/app/components/servers/LiveServerConsole.component.test.tsx src/app/components/servers/AllServersDirectory.component.test.tsx src/app/components/servers/CopyJoinButton.component.test.tsx src/app/components/servers/DownloadServerLogButton.component.test.tsx src/app/servers/managed-server-config-actions.component.test.tsx
```

**9 explicit node files / 39 tests passed**:

```sh
npx --no-install tsx --test src/app/lib/roadmap-migration.test.ts src/app/lib/homepage-video-migration.test.ts src/app/lib/homepage-videos.test.mjs src/app/cheats/locale.test.ts src/app/cheats/CheatsDirectory.test.tsx src/app/components/servers/ServerDirectoryTable.test.tsx supabase/functions/_shared/managed-server-configuration.test.ts supabase/functions/_shared/configuration-file-import.test.ts supabase/functions/_shared/server-log-contract.test.ts
```

Additional independent route review evidence: account/home/login 65 component tests plus roadmap migration; remaining public pages/runtime 144 component + 14 node tests; shared chrome 19 tests. Counts overlap other runs; do not sum as unique coverage. Original lane reports retain their directly affected action/component checks. No full suite/build/lint/typecheck, browser E2E, visual layout, production transport or native linguistic review is claimed. Full CI remains the PR gate.

Durable evidence under `G:/.pi-tmp/website-localization/`: `remaining-six-result.md`, `managed-final-result.md`, `foundation-review-result.md`, `review-fixes-result.md`, `rereview-final-result.md`, `main-overlap-fix-result.md`, `main-overlap-review-result.md`, `foundation-final-components.log`, `foundation-final-node.log`. Workflow results bind exact per-child reports, run IDs and retained sessions. The final coordinator handoff records original/integrated commit mappings, exact publication approval and PR URL. All native retained-resume containment failures were preserved; root-approved same-profile fresh fallbacks did not weaken trust checks or change runners. All original partial commits were retained and integrated once; original checkout and locale worktrees were not modified.
