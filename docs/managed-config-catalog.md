# Managed configuration catalog

Copy the exact LF bytes of the mod's `deploy/managed-config-catalog.json` into
`supabase/functions/_shared/managed-config-catalog.json`. The catalog contains
`contentDigest` and `options`. Record the producer commit and digest in
`managed-config-catalog-source.json`, and regenerate the TypeScript export from
that JSON for Supabase's TypeScript-only deployment recipe. Run
`npm run check:managed-config-catalog` in the website and control-plane repos.
Both commands fetch the same immutable producer file and compare its bytes.
The website command also checks the generated TypeScript export.

The editor uses each option's `availableSince` and the server's installed
version when that version is known. The control plane authoritatively checks
availability on writes and imports. The website parser fills optional settings
for older configurations using the required option set from released runner
`8e5c511dc3a9c9f9222429558c2df8816a03a4b7`, matching the control plane's
compatibility pin. The active campaign controls War Sails.

The editor and import admission retain the released runner's numeric ranges
during rollout. Reading settings still accepts newer catalog values, and the
editor's live Limitless limit still governs expanded battle sizes. Direct
saves and durable import rejections show the control plane's option-specific
refusal. The paired synthetic capture is `test/fixtures/managed-config-refusals-v1.json`.
