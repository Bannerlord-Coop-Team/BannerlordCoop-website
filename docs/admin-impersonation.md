# Administrator user impersonation

The website's `wrangler.jsonc` enables impersonation with
`ADMIN_IMPERSONATION_ENABLED=true`. With the setting unset or any value other
than `true`, Member
Administration hides the impersonation controls and the server action refuses
issuance before creating a grant or native login. Normal account and server
operations continue to work. Exit remains available for any existing session.

After the deployment prerequisites below are verified, set the server-only
`ADMIN_IMPERSONATION_ENABLED=true` to enable the feature.

Open **Member Administration**, search by name, email, account ID, provider or
role, and select **Impersonate user**. A direct account-ID form supports members
outside the bounded list. The website opens Servers with the selected user's
actual identity, membership, server access and permissions. Account changes,
server configuration, lifecycle operations, transfers, downloads and console
operations use the existing user controls and change real state.

The banner identifies the selected user and original administrator. **Choose
another user** returns to the original administrator's member picker. **Exit
impersonation** ends this delegated session and restores the original admin
login. Signing out during impersonation also exits. A session lasts at most 30
minutes; expiry retains the banner and Exit instead of silently granting admin
access. Selection affects the website's shared browser cookies, so it applies
across tabs for that browser profile.

## Authentication and authority

Only an authenticated account with current Auth `app_metadata.role=Admin` can
start impersonation. The server creates a separate native Supabase Auth login
for the selected account using `auth.admin.generateLink` and `verifyOtp`; no
email is sent and no customer password is needed. The service-role client never
adopts the target session. The native email/Discord website accounts must have
an Auth email; disabled/deleted accounts or failed native Auth issuance are
refused. This flow does not create an email for phone-only or anonymous accounts.
Native Auth may update sign-in/confirmation metadata as for a normal login.

The normal auth cookies hold the target session, so existing browser SDK calls,
Next actions, Edge Functions and the control plane operate with target
permissions. Impersonating an ordinary user does not grant that user the
administrator's privileges. An impersonated administrator retains that target's
own admin permissions. Provider OAuth still requires the provider's normal
consent/login. Linking Discord can issue another native session; it is bound to
the same impersonation without extending expiry; the prior session is retired.
A failed binding signs the
new login out locally.

The original login is retained separately in Secure, HttpOnly, SameSite=Lax
`__Host-impersonation-admin` cookies. The signed `__Host-view-as-user` marker
contains only grant, actor, target, native session IDs and timestamps. It uses a
purpose-separated HMAC with the existing server-only `SUPABASE_SECRET_KEY`.
The cookies persist until Exit, including after browser restart; the durable
grant expires after 30 minutes regardless of cookie retention. Exit can recover
a damaged marker using the independently verified admin backup. If the original
login is no longer valid, Exit returns to sign-in.

`website_impersonations` and `website_impersonation_sessions` bind the target's
native sessions to the exact original admin session. `website_session_context`
checks that grant on authenticated application requests, including the admin's
current role, deletion/ban status, session existence, grant expiry and explicit
end. Ordinary sessions return a null context. Nested grants from delegated
sessions are denied. The website, membership/Patreon Edge boundaries and control
plane authenticator fail closed when the check is unavailable. Existing
control-plane read-only streams retain their ordinary bounded lifetime.

Starting, ending and authenticated use are recorded in
`website_impersonation_events`, related to the real actor and target. Existing
domain audit records still identify the effective user and record operation
outcomes. Session-context events attest authorization, not successful completion
of an operation. Keep these session mappings and events as audit/revocation
history; deleting them would turn an old native token into an unmarked session.
Direct table access and grant-management RPCs are denied to browser roles.

Exit ends the durable grant and requests native **local** sign-out of only the
issued session. Transient revocation errors retain Exit for an explicit retry.
It does not request sign-out of the customer's other sessions. Native Auth
must allow concurrent sessions; a project configured for one session per user
can invalidate the customer's existing login when a new one is issued. Supabase access
JWTs retain their native cryptographic lifetime; application session-context
checks enforce earlier expiry/end. New authenticated application entrypoints
must use the same guard, including when they accept browser bearer tokens.

## Deployment order

1. Apply `202609300001_website_impersonation.sql` using the reviewed website
   Supabase migration process. This new migration is required before deploying
   consumers because ordinary authenticated requests also call the context RPC.
2. Deploy the paired ControlPlane authentication change, the `website-account`,
   `patreon-start`, `patreon-complete`, `patreon-callback` and `control-plane-admin`
   Edge Functions. Use their existing reviewed release processes. The legacy
   console gateway source and tests have been retired; this does not shut down
   any deployed service. Any still-active historical accepting service must
   retain or separately commission its session-context guard before enabling
   impersonation issuance.
3. The website can be released with impersonation disabled while an active
   accepting boundary's guard is still under development. Enable
   `ADMIN_IMPERSONATION_ENABLED=true` only
   after every active accepting boundary has the guard. Use the existing
   Supabase publishable key and server secret. Require authoritative Admin
   metadata for operators.

Do not enable issuance until every accepting boundary has the guard. No
ControlPlane schema migration is needed. Migration, Edge, gateway and application
releases are separate production operations; the PRs and local verification do
not deploy them. Rollback removes or disables `ADMIN_IMPERSONATION_ENABLED`
first and retains the SQL ledger and
all accepting guards until issued native sessions are no longer usable.

## Verification

`npm test` covers session selection, a real server-action write using the target
token, account mutation at the Edge boundary, OAuth registration, expiry,
revocation, damaged-marker recovery and local Exit. Embedded PostgreSQL executes
the actual migration and checks grants, session mapping, audits and denied access.
`node tests/impersonation-browser.mjs` runs the real Next/React pages and server
actions against disposable Auth/data transports: inventory isolation, an account
mutation, direct switching, Exit and expired-session recovery. It is local browser
evidence, not live Supabase/OAuth or production deployment evidence. Retired
legacy console gateway tests are no longer registered in `npm test`; these
checks do not attest guards on any still-active historical service.

The ControlPlane API QA suite exercises the real HTTP and Unix-socket path with
synthetic Auth responses: target-owner mutation, other-owner refusal, ordinary
user admin refusal, optimistic concurrency, idempotency and ended-session refusal.
