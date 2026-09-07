-- Private OAuth data: only the service role may read or write these tables.
create table public.patreon_oauth_states (
    token_hash text primary key,
    kind text not null check (kind in ('ticket', 'state', 'complete')),
    patreon_user_id text,
    user_id uuid not null references auth.users(id) on delete cascade,
    expires_at timestamptz not null
);

create table public.patreon_accounts (
    user_id uuid primary key references auth.users(id) on delete cascade,
    patreon_user_id text not null unique,
    linked_at timestamptz not null default now()
);

alter table public.patreon_oauth_states enable row level security;
alter table public.patreon_accounts enable row level security;
revoke all on public.patreon_oauth_states, public.patreon_accounts from public, anon, authenticated;
grant select, insert, update, delete on public.patreon_oauth_states, public.patreon_accounts to service_role;
