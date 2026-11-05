# Repository contribution guidance

## Cross-repo contract verification (required)

Changes to a managed-hosting nightly publication marker, client/server release
pairing, or website/web-admin HTTP/IPC contract must follow the ControlPlane
[pre-merge verification rule](https://github.com/Bannerlord-Coop-Team/BannerlordCoop.ControlPlane/blob/main/AGENTS.md#pre-merge-verification-required)
and its [cross-repo fixture procedure](https://github.com/Bannerlord-Coop-Team/BannerlordCoop.ControlPlane/blob/main/docs/managed-hosting/qa-execution.md#cross-repo-contract-fixtures).
The rule is introduced by [ControlPlane PR #871](https://github.com/Bannerlord-Coop-Team/BannerlordCoop.ControlPlane/pull/871).

Before marking an affected PR ready, check the same versioned, sanitized contract
fixture and capture provenance into both producer and consumer repositories.
Validate each side's real serializer/parser or request handler against it,
including incompatible-input rejection. Mocks must assert exact requests and
reject unexpected or extra calls; a fixture tested on only one side is not
cross-repo evidence.

Record the acceptance scenario, both tested repository heads, fixture
schema/version and content digest, paired PR links, exact validation commands,
pass/fail results, and artifact paths. Preserve old-version fixtures while
deployed peers still require them. Missing fixtures or required validation block
readiness. Production verification stays required after an authorized rollout
and cannot replace this pre-merge evidence.

**TODO(CROSS-REPO:FIXTURE-VALIDATORS):** the owning contract change must publish
the shared fixture path and each repository's validator. This guidance does not
claim that a fixture or passing compatibility result already exists.
