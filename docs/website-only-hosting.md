# Website-only managed hosting

Managed hosting uses the verified Supabase account UUID. Discord is an optional
login provider and is no longer required for assignments, grants, ownership,
Patreon allocation or server controls. Administrator selectors list all website
accounts; labels never determine identity. The control plane resolves legacy
assignments through its immutable account binding.

Owners use `/servers` and the server page. The game-password form sets a private
custom password using the current server generation. A running server queues a
warned restart. No password or secret reference is returned; refresh current
status after an uncertain response instead of automatically resubmitting.

Deploy with the matching control-plane and Bot_UP retirement branches. Apply
`202609280002_control_plane_website_accounts.sql` and
`202609280003_account_owned_membership.sql` once during the coordinated migration
window, then deploy the matching control-plane/web adapter, membership Edge code
and website before resuming hosting writes. Both repositories mirror the exact
migration bytes. Bot_UP unregisters the old server command and stops hosting
notification/enrollment consumers. Owner announcements through Discord are retired.

The first migration freezes legacy verified Auth claims before unlinking can
remove them. Ambiguous or unclaimed historical assignments require administrator
review/transfer; never infer ownership from matching email or display name.
Disconnecting Discord leaves existing account bindings and Patreon evidence intact.
Actual Patreon identity changes and account deletion still invalidate membership.
Older invalidated evidence requires a fresh Patreon verification.

Historical wire fields and receipt values remain parseable for compatibility.
Do not rewrite existing job hashes, provider tags, audit events or creation receipts.
The forward migration introduces UUID principals, so rollback requires a coordinated
state-aware plan; old numeric-only application code cannot safely read new records.
These source changes and local tests do not perform or authorize production rollout.

Apply the prerequisite `202609280001_control_plane_retired_tables.sql` through the
control-plane retirement runbook before the account migrations. Its website mirror
retains the exact merged SQL; the unmerged account migrations use versions 002 and
003 to avoid colliding with that history. A rejected browser password action clears
the input and explains that the outcome is unknown and status must be refreshed
before trying again; it never retries automatically.

The administrator Slots, Servers and Ownership views display the website account
email (then phone/account UUID when no email exists). They resolve historical
numeric owners using `ownerAccountId` supplied by the control plane's immutable
binding, including after Discord unlink. Deploy the matching control-plane API
change before the website to resolve these legacy owners. Unbound owners display
`Legacy owner (ID)`; a missing/deleted account or unavailable directory displays
`Account unavailable (UUID)`. Emails remain in the authenticated administrator
website and never determine ownership or appear in public server listings.
