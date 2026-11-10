# Boosty real-response fixtures

Captured 2026-11-10 from the creator's own blog (`bannerlordcoop`) with the creator's
credential, read-only (one token refresh plus GETs of the subscriber list, `/v1/dialog/?limit=20`
and one dialog's `/message/?limit=20`), then sanitized. The raw capture stays with the owner.

Not kept as fixtures because the adapter never calls them: `GET /v1/user/current` returns the
creator's blog slug in `blogUrl` (`bannerlordcoop`), and
`GET /v1/blog/bannerlordcoop/subscription_level/?show_free_level=true` lists the levels used to
write `BOOSTY_MEMBERSHIP_POLICY_JSON` (`price` is in USD, the blog currency):

| Level id | Name | USD |
| --- | --- | --- |
| 4018927 | Follower (free) | 0 |
| 4035410 | Сторонник | 5 |
| 4035411 | Суперспонсор | 10 |
| 4035416 | Мегаспонсор | 20 |
| 4035417 | Гига-спонсор | 50 |
| 4035418 | Главный спонсор | 100 |

Sanitization keeps every field name, type and nesting exactly; it replaces:

- every person's `name`, `email`, `avatarUrl` and `url`, level descriptions and message text (one message now carries the
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
