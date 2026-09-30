# View the website as a user

Open **Member Administration**, search by name, email, account ID, provider or
role, and select **View as user**. A direct account-ID form also supports users
outside the bounded member list. The website opens Servers with that user's
identity, roles, durable server access and account/membership status. Navigate
normally to Account or a server's management tabs. **Choose another user**
returns to the administrator's member picker; **Exit impersonation** restores
the original admin view without signing either person out.

This mode is read-only. Inputs remain visible as they would be for the user,
but server actions reject account/provider links, role/access changes and server
mutations. Console connections and save/log downloads are unavailable. The
banner identifies both the selected account and real administrator. Member
Administration remains the real administrator's user picker, not a target-user
privilege escalation path. Control Plane administration requires exiting first.

The HttpOnly, Secure, SameSite=Lax `__Host-view-as-user` cookie is signed with a
purpose-separated HMAC using the existing server-only `SUPABASE_SECRET_KEY`.
It contains IDs and a deadline, never tokens. The selection is bound to the
verified administrator ID and Auth session ID, and lasts 30 minutes. Its marker
is retained until explicit exit or browser-session end so expiry fails closed
instead of silently restoring administrator authority. Missing/deleted targets,
revoked admin access, changed login, key rotation and tampering also fail closed.
Exit remains available during failures. Starting or changing the selection
invalidates the website layout; stale read markers cannot select another user.

The real admin session is reverified with Auth for every preview request. Target
metadata and identities are fetched through Auth's admin API; display metadata
never establishes legacy ownership. Client components receive only a selection
marker, not either user's login token. The control plane's audited `view-as-user`
operation strips administrator roles before executing the same owner reads used
by ordinary users. It preserves owner/manager/support distinctions and records
the real admin and target under `hosting.website_user_previewed`.

Account status uses the admin-only `website-account` `preview-status` operation
and service-only `membership_preview_status` RPC. It reads membership evidence
without creating bindings, fencing identity drift, consuming provider authority
or queueing synchronization. If stored identity/link evidence is stale, that
part of the UI reports unavailable; an ordinary account login must reconcile
it. Preview never invents successful synchronization.

## Deployment order

1. Release the ControlPlane `view-as-user` operation through its normal reviewed
   deployment. This application change needs no ControlPlane schema migration.
2. Apply `202609300001_website_user_preview.sql` using the website's reviewed
   Supabase migration process, then deploy the updated `website-account` Edge
   Function. Preserve existing migration history; do not replay mirrored SQL.
3. Release the website. It uses the existing Supabase configuration and server
   secret. Administrators need the authoritative Auth `app_metadata.role=Admin`
   used by the existing Edge administrator boundary. No target credentials or
   new signing secret are needed.

These are separate production operations. Local tests and pull requests do not
apply the migration or deploy any service. Starting a preview fails visibly if
the control plane does not support the operation; unavailable membership preview
does not fall back to a writable status request.

## Verification

`npm test` includes session/mutation-boundary tests and an embedded PostgreSQL
migration test. The latter checks real SQL execution, preservation of account and
outbox rows, stale-evidence refusal and denied anonymous/authenticated execution.
`node tests/impersonation-browser.mjs` exercises the real Next/React page and
action flow against disposable authentication/data fixtures. It proves local
browser behavior, not a production login or deployment. ControlPlane's explicit
API QA suite covers real HTTP and Unix-socket owner/manager isolation, audit
records, unknown-target isolation, mutation refusal and unchanged account bindings.
