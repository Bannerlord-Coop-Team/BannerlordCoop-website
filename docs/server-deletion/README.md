# Server deletion mock

Captured from `/servers/wireframe` on 2026-10-07 using the actual shared deletion
panel. Its submit callback returns a local mock receipt. No signed-in account,
control-plane request, provider mutation, save or live server was used.

Run `npm ci`, then `npm run dev -- --port 3107`, visit
`http://localhost:3107/servers/wireframe`, and select **Settings**.

- [Settings panel, desktop (1440 × 1040)](mock-desktop-settings.png)
- [Empty confirmation, desktop (1440 × 1040)](mock-desktop-confirmation.png)
- [Confirmed name and acknowledgement, desktop (1440 × 1040)](mock-desktop-ready.png)
- [Confirmed name and acknowledgement, mobile (390 × 844)](mock-mobile-confirmation.png)

Cancel is focused when the dialog opens. The submit button stays disabled until
the server name matches exactly and the acknowledgement is checked. Mobile layout
has no horizontal overflow. A mock submission shows pending deletion, not completion.
