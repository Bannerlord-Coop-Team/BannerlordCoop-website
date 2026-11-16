-- The nightly gateway stored encrypted Discord refresh tokens it never read. The Supabase Edge
-- Function stops storing them, so both columns become optional and existing values are cleared.
-- The Cloudflare Worker keeps inserting both columns until it is slimmed down; its values still
-- satisfy the relaxed checks, so this migration is safe to apply while it runs.
begin;

alter table nightly_gateway.supporter_grants
    alter column encrypted_refresh_token drop not null,
    alter column token_nonce drop not null,
    drop constraint supporter_grants_refresh_token,
    drop constraint supporter_grants_nonce,
    add constraint supporter_grants_refresh_token
        check (encrypted_refresh_token is null or char_length(encrypted_refresh_token) between 16 and 4096),
    add constraint supporter_grants_nonce
        check (token_nonce is null or token_nonce ~ '^[A-Za-z0-9_-]{16}$'),
    add constraint supporter_grants_refresh_token_pair
        check ((encrypted_refresh_token is null) = (token_nonce is null));

update nightly_gateway.supporter_grants
set encrypted_refresh_token = null, token_nonce = null
where encrypted_refresh_token is not null or token_nonce is not null;

comment on column nightly_gateway.supporter_grants.encrypted_refresh_token is
    'Retired: always NULL once the Worker stops writing it; TOKEN_ENCRYPTION_KEY is no longer used.';
comment on column nightly_gateway.supporter_grants.token_nonce is
    'Retired with encrypted_refresh_token.';

commit;
