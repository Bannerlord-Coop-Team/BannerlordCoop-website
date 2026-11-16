# Campaign reset status v1

This directory is byte-identical in ControlPlane #1034 and Website #444 for
`v1.json`, `capture-v1.json`, and `provenance.json`. It contains no customer data
or production credentials.

- `v1.json`: versioned request bindings, states, safe failure projections and
  unsupported-peer cases. SHA256:
  `087b62286e600dbe715f6d809946bbd3db5e8aaf9db900c48e2679fe3da99b4a`.
- `capture-v1.json`: exact sanitized exchanges from the actual Website client
  and Edge handler through CP's owner HTTP/IPC/runtime and migrated ephemeral
  PGlite. It records one Reset submission, queued/refused status reads, an
  unrelated identity refusal, and an unsupported read against CP `80d0fc26`.
  Authorization headers are redacted; every identity and state is synthetic.
- `provenance.json`: capture heads, both PRs, fixture/capture digests and
  normalized source digests for the capture. Final tested heads
  and commands are recorded in both PRs' evidence fields.

ControlPlane validator:

```sh
npm run test:hosting:api -- test/hosting-api/reset-campaign-restart.test.ts
```

This exercises real owner request parsing and status serialization, current
authorization, job binding, safe worker refusal before purge, supported reset
and subsequent Start, and interrupted-worker recovery. Invalid request shapes
are rejected. Fixture/capture digests must match their provenance.

Website validator:

```sh
npm run test:campaign-reset
```

This exercises real client/Edge routing with exact requests, strict result
parsing including invalid/private shapes, unsupported older peers, and native
authenticated-action/component presentation tests. It never retries Reset from
a status read. The canonical fixture substitutes fixed server/job UUIDs for the
generated synthetic bindings; captured result fields are otherwise unchanged.

Website is reader-first and tolerates CP without this method. ORCH decides
merge/deploy order. Offline fixture/API evidence is separate from CI and
production: not proven here are deployed JWT verification/TLS, browser behavior,
installed runner/CRIU/Podman, public UDP, gameplay or multiplayer load.
