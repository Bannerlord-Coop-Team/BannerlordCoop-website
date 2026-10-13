# Supabase managed-hosting API deployment

Cloudflare website builds do not deploy Supabase functions. A successful website
build alone does not establish API availability. In October 2026, the website
and control plane accepted the expanded mod configuration, but the older
`my-servers` bundle rejected it, hiding save metadata and configuration controls.

`.github/workflows/deploy-hosting-functions.yml` tests the hosting API contracts
on relevant pull requests and deploys affected APIs on pushes to main. Manual
dispatch is restricted to main and checks all three APIs. Configure the encrypted
GitHub Actions secret `SUPABASE_ACCESS_TOKEN` with a Supabase management access
token authorized to deploy to project `wfvqnijwuyqjibhlcrhz`. A service-role key
or database password is not a management token. Never print or commit the token.

The explicit deployment scope is:

| Function | Gateway JWT verification |
| --- | --- |
| `my-servers` | Required |
| `control-plane-admin` | Required |
| `public-servers` | Disabled for the existing read-only public directory |

Membership/OAuth functions, alert schedulers, database migrations, runtime
secrets, and control-plane/runner deployments remain outside this workflow.
Their documented commissioning and coordinated-release requirements still apply.

The workflow uses the pinned Supabase CLI 2.120.0 and `--use-api` for both
deployment and download; it does not launch Docker. Deployment runs are serialized
and an active run is never cancelled by a newer commit. Every run keeps its own
checked-out source SHA.

The source check follows relative imports and re-exports, including type-only and
transitive shared dependencies. Every run checks all three APIs against live
source, so skipped intermediate commits cannot hide an undeployed change.
A shared configuration change therefore redeploys every importing API.
Unrelated shared membership code does not change hosting source digests.
Unsupported external/dynamic imports, runtime/import-map configuration, and
authentication policy changes fail closed until the recipe is updated.

Before each write, the workflow downloads the live source and checks active state,
JWT policy, and the complete source graph against the checkout. Already-current
functions are not redeployed. After a write, the same checks run again. A lost
deployment response is reconciled through the uploaded source once, without
launching a competing retry. Failed or unconfirmed verification fails the run;
it never claims deployment completion or automatically rolls back.

The read-only smoke checks confirm that protected APIs reject requests without
authentication and that the public directory returns a valid success envelope.
The job summary and `supabase-hosting-deployment.json` artifact record the source
commit, per-function digest, deployed version, JWT policy, and smoke result.
Partial failures retain the verified entries and mark the overall receipt failed.
They contain no user records, configuration values, tokens, or private save data.

## Local validation and incident checks

```sh
npm run test:supabase:deployment
node scripts/deploy-hosting-functions.mjs plan
```

With the pinned native CLI available on PATH and the management token already
in the process environment, this read-only command checks all three deployed APIs:

```sh
node scripts/deploy-hosting-functions.mjs verify
```

The `deploy` command refuses to run outside the main GitHub workflow. Ordinary
recovery should use a main workflow dispatch, reconcile its receipt, and preserve
the existing function secrets and authentication policy. Do not use `--prune`,
`--no-verify-jwt`, or schema pushes to force a deployment through.

## Release order and evidence

Deploy required schema and control-plane support before merging an API change
that depends on them. Cloudflare and GitHub currently start independently on main;
these changes do not make the website/API rollout atomic. Follow both the
Cloudflare website deployment and **Deploy Supabase hosting APIs** through
completion for the same release before reporting it successful. Keep API changes
compatible with the preceding website during that interval.

Contract tests and source verification do not prove owner-specific runner reads
or writes. After a save/config contract rollout, use a legitimately authenticated
owner or the audited administrator impersonation flow to open Save & config,
confirm the selected campaign and loaded runner settings, then exit impersonation.
Do not import, export, save settings, restart, or start a game merely to verify
these reads. The October repair was checked on the affected production owner page.
