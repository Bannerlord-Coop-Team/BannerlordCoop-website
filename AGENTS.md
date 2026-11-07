# Repository contribution guidance

## Contracts shared with ControlPlane

This addendum applies only to payloads or operations this repository consumes
from or produces for ControlPlane. Keep Website's existing tests, CI and release
gates; use its native `npm test`, `npm run lint` and `npm run build` as applicable.

- Check the same sanitized, versioned fixture and provenance into both owning
  repos, with both tested heads, content digest and paired PR links. Use the
  [paired-fixture procedure](https://github.com/Bannerlord-Coop-Team/BannerlordCoop.ControlPlane/blob/main/docs/managed-hosting/qa-execution.md#cross-repo-contract-fixtures)
  for contract coordination.
- Execute the changed operation and capture exact requests and real responses
  for anything CP consumes or produces, including successful empty responses.
  For published objects, prove the consumer URL resolves to the publisher's
  exact public/private bucket and key and fetches the same bytes/digest.
- Until paired fixture validators land, require the relevant Website-native
  tests plus a manual check through both implementations. Paste exact commands,
  sanitized output, exit status, expected/actual result and `not proven: X`
  limits into the PR body. Name the owning paired fixture validators as the
  replacement when merged; a pending validator alone does not block this interim
  path. Preserve existing approval and deployment requirements.
