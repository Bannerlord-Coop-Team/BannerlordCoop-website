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
| Send or Enter | Submit once without confirmation; clear accepted input | Component; browser |
| Submission awaiting acceptance | Block duplicate sends only while the submission request is in flight | Component |
| Accepted command | Clear input and immediately allow the next command; no execution polling, acknowledgement, or completion UI | Component; browser |
| Uncertain delivery | Keep original payload/UUID; the same input-row button retries that request | Component |
| Invalid or rejected command | Report the error in the console, not beneath the input | Component |
| Read-only or non-running server | Input and Send remain disabled | Component |
| Supported prefix | Tab accepts one dot-delimited segment without submitting | Component; browser |
| Unknown prefix, complete command, arguments, or selection away from end | Tab retains normal navigation | Component |
| Shift+Tab | Preserve backward navigation | Component |

Commands are fire-and-forget after enqueue acceptance. Request identity and
authorization remain unchanged; uncertain delivery still retains the original
request for a safe retry. Execution results arrive through live stdout, without
website result polling or acknowledgement. Unacknowledged Discord completion/recovery
delivery remains enabled. Backend result/acknowledgement APIs are unchanged.

## Stream lifecycle

| Path | Expected behavior | Coverage |
| --- | --- | --- |
| Load | Auto-connect once; no connection button or separate indicator | Component; screenshot |
| Strict Mode/unmount | Abort old stream and permit fresh setup | Component |
| Server switch | Ignore the previous connection's late response | Component |
| Unavailable/expired stream | Retain output and existing reload guidance; no automatic retry | Component |
| Retained output | Keep existing memory, line and SSE-frame bounds | Existing stream tests |
