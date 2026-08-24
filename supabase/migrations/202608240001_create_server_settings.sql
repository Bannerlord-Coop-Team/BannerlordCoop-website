begin;

create table if not exists public.server_settings (
    server_id text primary key,
    display_name text not null,
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id) on delete set null,
    constraint server_settings_server_id_format check (
        server_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    ),
    constraint server_settings_display_name_length check (
        char_length(display_name) between 1 and 80
    ),
    constraint server_settings_display_name_trimmed check (
        display_name = btrim(display_name)
    )
);

comment on table public.server_settings is
    'Global user-editable settings for configured Bannerlord servers.';
comment on column public.server_settings.display_name is
    'Global display-name override; the configured catalog name remains the fallback.';

alter table public.server_settings enable row level security;

-- The website reauthenticates and authorizes every mutation in a Server Action.
-- Browser-facing Supabase roles receive no direct table access.
revoke all on table public.server_settings from public, anon, authenticated;
grant select, insert, update on table public.server_settings to service_role;

commit;
