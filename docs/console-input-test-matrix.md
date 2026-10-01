# Managed console input test matrix

The managed console keeps its existing command confirmation, request identity,
polling, result acknowledgement, and access restrictions. Its idle command UI is
only an input and Send button below live output, inside the same card.

| Path | Expected behavior | Coverage |
| --- | --- | --- |
| Page load → connecting → connected | Connect automatically once on mount; no connection button or separate status indicator | Component; browser screenshot |
| Strict Mode setup/cleanup or unmount | Abort the old stream and allow a fresh mount to connect | Component |
| Switch servers while connecting | Cancel the previous stream and ignore its late response | Component |
| Unavailable or expired stream | Show a notice and reload guidance inside the output, retaining existing lines; no automatic retry | Component |
| Idle managed console | Live output precedes the form in one card; no empty result panel | Component |
| Supported command prefix at end of focused input | Ghost stops at next `.`; successive Tabs accept one segment without submitting or inserting argument placeholders | Component |
| Unknown prefix, complete command, arguments, or caret/selection away from end | No completion; Tab keeps normal navigation | Component |
| Shift+Tab | Leaves draft unchanged and keeps backward navigation | Component |
| Send or native form submission (Enter) | Uses the same confirmed command action | Component; browser keyboard check |
| Pending, uncertain, or completed request | Existing retry identity, polling, plaintext results and acknowledgement remain intact | Existing component tests |
| Read-only or non-running server | Input and Send remain disabled | Existing component tests |

Autocomplete uses the existing published server-side `coop.*` catalog, not runtime
command discovery. Arguments are entered manually or inserted through the existing
command picker.
