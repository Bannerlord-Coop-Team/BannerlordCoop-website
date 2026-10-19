# Managed console input test matrix

The command UI is the input, its Send button, and “Enter to send.” Sending no longer
opens a confirmation dialog. Command output belongs in the existing live console,
not a second result panel. Tab completion remains available without a footer hint.

## Command output

| Path | Expected behavior | Coverage |
| --- | --- | --- |
| Valid `@DS@` managed-command stdout record | Hide envelope/ID, decode line breaks, highlight command names/placeholders/headings with a subtle gold treatment | Component; desktop/mobile screenshots |
| Managed command with `ok: false` | Red command-output treatment, not a success message | Component; screenshot |
| Ordinary stdout, another event, malformed JSON or wrong field types | Retain original text without command styling | Component |
| HTML-looking command output | Render escaped text, never markup | Component |
| Split SSE frame | Wait for the complete frame before displaying the highlighted record | Component |

## Input and delivery

| Path | Expected behavior | Coverage |
| --- | --- | --- |
| Send or Enter | Dispatch without confirmation; clear and refocus input immediately, before any response | Component; browser |
| Submission awaiting acceptance | Allow multiple commands while prior submission promises remain unresolved; each gets its own payload/UUID | Component; browser |
| Late acceptance | Do not clear a newer draft; no execution polling, acknowledgement, or completion UI | Component |
| Late rejection or uncertain delivery | Identify the failed command in the console without locking input or changing a newer draft; no retry workflow | Component |
| Invalid draft | Keep the draft editable and report validation errors in the console without dispatching | Component |
| Read-only or non-running server | Input and Send remain disabled | Component |
| Supported prefix | Tab accepts one dot-delimited segment without submitting | Component; browser |
| Unknown prefix, complete command, arguments, or selection away from end | Tab retains normal navigation | Component |
| Shift+Tab | Preserve backward navigation | Component |

Commands are fire-and-forget from the composer: it never waits for submission
acceptance or execution. Each dispatch retains authorization and a fresh request
UUID, but there is no in-flight lock or request-retry UI. The existing authenticated
server-action transport handles submissions; no browser-side execution queue is added.
Late errors identify their command without modifying the current draft. Execution
results arrive through live stdout. Backend APIs and Discord delivery are unchanged.

## Stream lifecycle

| Path | Expected behavior | Coverage |
| --- | --- | --- |
| Load | Auto-connect once; no connection button or separate indicator | Component; screenshot |
| Strict Mode/unmount | Abort old stream and permit fresh setup | Component |
| Server switch | Ignore the previous connection's late response | Component |
| Unavailable/expired stream | Retain output and existing reload guidance; no automatic retry | Component |
| Retained output | Keep existing memory, line and SSE-frame bounds | Existing stream tests |
