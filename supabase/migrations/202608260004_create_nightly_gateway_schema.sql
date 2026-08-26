begin;

create schema if not exists nightly_gateway;
revoke all on schema nightly_gateway from public, anon, authenticated;

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'nightly_gateway_runtime') then
        create role nightly_gateway_runtime nologin nosuperuser nocreatedb nocreaterole noinherit;
    end if;
end
$$;

grant usage on schema nightly_gateway to nightly_gateway_runtime;

create table nightly_gateway.device_sessions (
    id uuid primary key,
    device_secret_hash text not null unique,
    user_code text not null unique,
    status text not null,
    discord_user_id text,
    sponsor_discord_user_id text,
    oauth_state_hash text unique,
    created_at bigint not null,
    expires_at bigint not null,
    authorized_at bigint,
    constraint device_sessions_secret_hash check (device_secret_hash ~ '^[0-9a-f]{64}$'),
    constraint device_sessions_user_code check (user_code ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'),
    constraint device_sessions_status check (status in ('pending', 'awaiting-sponsor', 'approved', 'denied', 'consumed')),
    constraint device_sessions_discord_user check (discord_user_id is null or discord_user_id ~ '^[0-9]{17,20}$'),
    constraint device_sessions_sponsor_user check (sponsor_discord_user_id is null or sponsor_discord_user_id ~ '^[0-9]{17,20}$'),
    constraint device_sessions_created_at check (created_at > 0),
    constraint device_sessions_expires_at check (expires_at >= created_at),
    constraint device_sessions_authorized_at check (authorized_at is null or authorized_at >= created_at)
);

create index device_sessions_expiry on nightly_gateway.device_sessions(expires_at);

create table nightly_gateway.supporter_grants (
    supporter_discord_user_id text primary key,
    encrypted_refresh_token text not null,
    token_nonce text not null,
    sponsor_code_hash text unique,
    updated_at bigint not null,
    constraint supporter_grants_user check (supporter_discord_user_id ~ '^[0-9]{17,20}$'),
    constraint supporter_grants_refresh_token check (char_length(encrypted_refresh_token) between 16 and 4096),
    constraint supporter_grants_nonce check (token_nonce ~ '^[A-Za-z0-9_-]{16}$'),
    constraint supporter_grants_sponsor_code check (sponsor_code_hash is null or sponsor_code_hash ~ '^[0-9a-f]{64}$'),
    constraint supporter_grants_updated_at check (updated_at > 0)
);

create table nightly_gateway.sponsorships (
    supporter_discord_user_id text not null references nightly_gateway.supporter_grants(supporter_discord_user_id) on delete cascade,
    sponsored_discord_user_id text not null unique,
    created_at bigint not null,
    primary key (supporter_discord_user_id, sponsored_discord_user_id),
    constraint sponsorships_sponsored_user check (sponsored_discord_user_id ~ '^[0-9]{17,20}$'),
    constraint sponsorships_distinct_users check (supporter_discord_user_id <> sponsored_discord_user_id),
    constraint sponsorships_created_at check (created_at > 0)
);

create index sponsorships_supporter on nightly_gateway.sponsorships(supporter_discord_user_id, created_at);

create table nightly_gateway.download_sessions (
    token_hash text primary key,
    device_session_id uuid unique references nightly_gateway.device_sessions(id) on delete cascade,
    discord_user_id text not null,
    supporter_discord_user_id text not null references nightly_gateway.supporter_grants(supporter_discord_user_id) on delete cascade,
    created_at bigint not null,
    expires_at bigint not null,
    constraint download_sessions_token_hash check (token_hash ~ '^[0-9a-f]{64}$'),
    constraint download_sessions_discord_user check (discord_user_id ~ '^[0-9]{17,20}$'),
    constraint download_sessions_supporter_user check (supporter_discord_user_id ~ '^[0-9]{17,20}$'),
    constraint download_sessions_created_at check (created_at > 0),
    constraint download_sessions_expires_at check (expires_at >= created_at)
);

create index download_sessions_expiry on nightly_gateway.download_sessions(expires_at);

create table nightly_gateway.oauth_states (
    state_hash text primary key,
    purpose text not null,
    created_at bigint not null,
    expires_at bigint not null,
    constraint oauth_states_hash check (state_hash ~ '^[0-9a-f]{64}$'),
    constraint oauth_states_purpose check (purpose = 'sponsor-portal'),
    constraint oauth_states_created_at check (created_at > 0),
    constraint oauth_states_expires_at check (expires_at >= created_at)
);

create table nightly_gateway.sponsor_sessions (
    token_hash text primary key,
    supporter_discord_user_id text not null references nightly_gateway.supporter_grants(supporter_discord_user_id) on delete cascade,
    created_at bigint not null,
    expires_at bigint not null,
    constraint sponsor_sessions_token_hash check (token_hash ~ '^[0-9a-f]{64}$'),
    constraint sponsor_sessions_created_at check (created_at > 0),
    constraint sponsor_sessions_expires_at check (expires_at >= created_at)
);

create index sponsor_sessions_expiry on nightly_gateway.sponsor_sessions(expires_at);

create table nightly_gateway.installer_pins (
    token_hash text primary key,
    build_id text not null unique,
    client_sha text not null,
    server_sha text not null,
    client_file_name text not null,
    client_bytes integer not null,
    client_sha256 text not null,
    server_file_name text not null,
    server_key text not null,
    server_public_url text not null,
    server_bytes bigint not null,
    server_sha256 text not null,
    created_at bigint not null,
    expires_at bigint not null,
    consumed_at bigint,
    constraint installer_pins_token_hash check (token_hash ~ '^[0-9a-f]{64}$'),
    constraint installer_pins_build_id check (build_id ~ '^[0-9]{17,20}$'),
    constraint installer_pins_client_sha check (client_sha ~ '^[0-9a-f]{40}$'),
    constraint installer_pins_server_sha check (server_sha ~ '^[0-9a-f]{40}$'),
    constraint installer_pins_client_file check (client_file_name = 'Coop.7z'),
    constraint installer_pins_client_bytes check (client_bytes between 1 and 8388608),
    constraint installer_pins_client_digest check (client_sha256 ~ '^[0-9a-f]{64}$'),
    constraint installer_pins_server_file check (server_file_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\\.7z$'),
    constraint installer_pins_server_key check (char_length(server_key) between 1 and 512),
    constraint installer_pins_server_url check (char_length(server_public_url) between 1 and 2048),
    constraint installer_pins_server_bytes check (server_bytes between 1 and 6442450944),
    constraint installer_pins_server_digest check (server_sha256 ~ '^[0-9a-f]{64}$'),
    constraint installer_pins_created_at check (created_at > 0),
    constraint installer_pins_expires_at check (expires_at >= created_at),
    constraint installer_pins_consumed_at check (consumed_at is null or consumed_at >= created_at)
);

create index installer_pins_expiry on nightly_gateway.installer_pins(expires_at);

create table nightly_gateway.pin_download_sessions (
    token_hash text primary key,
    pin_token_hash text not null references nightly_gateway.installer_pins(token_hash) on delete cascade,
    created_at bigint not null,
    expires_at bigint not null,
    constraint pin_download_sessions_token_hash check (token_hash ~ '^[0-9a-f]{64}$'),
    constraint pin_download_sessions_created_at check (created_at > 0),
    constraint pin_download_sessions_expires_at check (expires_at >= created_at)
);

create index pin_download_sessions_pin on nightly_gateway.pin_download_sessions(pin_token_hash);
create index pin_download_sessions_expiry on nightly_gateway.pin_download_sessions(expires_at);

grant select, insert, update, delete on all tables in schema nightly_gateway to nightly_gateway_runtime;
alter default privileges in schema nightly_gateway revoke all on tables from public, anon, authenticated;
alter default privileges in schema nightly_gateway grant select, insert, update, delete on tables to nightly_gateway_runtime;

comment on schema nightly_gateway is
    'Private durable state for the Cloudflare nightly-access gateway; not exposed through the Supabase Data API.';

commit;
