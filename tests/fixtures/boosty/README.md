# Boosty real-response fixtures

Captured 2026-11-10 from the creator's own blog (`bannerlordcoop`) with the creator's
credential, read-only (one token refresh plus GETs of `/v1/user/current`, the subscriber list,
`/v1/blog/bannerlordcoop/subscription_level/?show_free_level=true`, `/v1/dialog/?limit=20` and
one dialog's `/message/?limit=20`), then sanitized. The raw capture stays with the owner.

Sanitization keeps every field name, type and nesting exactly; it replaces:

- every person's `name`, `email`, `avatarUrl` and `url`, the creator's account strings
  (`webSocket.*`, `authSource.id`, Discord names, `geo.countryCode`, `timezone`), level names,
  level descriptions, Discord role names/ids and message text (one message now carries the
  synthetic link code `BLC-AB12C-DE34F`);
- every user, dialog, message, donation and target id with consistent synthetic ids
  (users 9000001+, dialogs 7000001+, messages 5000001+); level ids and prices are the
  creator's public pricing and are kept, as is the blog slug;
- token values with placeholders (`expires_in` is kept: seconds, 30 days);
- every timestamp with whole days from the fixed test clock 2026-11-10T12:00:00Z, keeping
  their order and which side of the capture instant they fell on.

The subscriber page is reduced to one row per observed state (free follower, active,
paused, cancelled but still paid, lapsed) with `total` and `offset` set to 5, and the dialog
page to two dialogs. Nothing else was edited.
