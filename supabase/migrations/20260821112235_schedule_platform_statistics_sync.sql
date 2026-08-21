create extension if not exists pg_cron
with schema extensions;

create extension if not exists pg_net
with schema extensions;

select cron.schedule(
               'sync-platform-statistics-every-six-hours',
               '0 */6 * * *',
               $$
                   select net.http_post(
        url :=
            'https://wfvqnijwuyqjibhlcrhz.supabase.co/functions/v1/sync-platform-statistics',
        headers := jsonb_build_object(
            'Content-Type',
            'application/json',
            'Authorization',
            'Bearer ' || (
                select decrypted_secret
                from vault.decrypted_secrets
                where name = 'platform_sync_token'
                limit 1
            )
        ),
        body := '{}'::jsonb
    );
$$
);