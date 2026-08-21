create table public.platform_statistics
(
    platform    text primary key
        check (platform in ('steam', 'nexus', 'moddb')),

    metric      text        not null
        check (
            metric in ('current_subscribers', 'unique_downloads', 'total_downloads')
            ),
    value       bigint      not null
        check (value >= 0),

    source_url  text        not null,

    measured_at timestamptz not null,

    updated_at  timestamptz not null default now()
);

alter table public.platform_statistics enable row level security;

create
policy "Anyone can read platform statistics"
on public.platform_statistics
for
select
    to anon, authenticated
    using (true);

revoke insert, update, delete
    on public.platform_statistics
    from anon, authenticated;