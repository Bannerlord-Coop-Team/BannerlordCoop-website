set lock_timeout = '5s';
set statement_timeout = '60s';

-- Smaller ranges reduce lossy heap reads for the RPC's two-minute window.
create index concurrently if not exists server_statistics_updated_at_brin8_idx
  on public.server_statistics using brin (updated_at) with (pages_per_range = 8);

do $guard$
begin
  if not exists (
    select 1
    from pg_catalog.pg_index i
    join pg_catalog.pg_class idx on idx.oid = i.indexrelid
    join pg_catalog.pg_am am on am.oid = idx.relam
    join pg_catalog.pg_opclass op on op.oid = i.indclass[0]
    where i.indexrelid = to_regclass('public.server_statistics_updated_at_brin8_idx')
      and i.indrelid = 'public.server_statistics'::regclass
      and am.amname = 'brin' and op.opcdefault
      and i.indisvalid and i.indisready and i.indislive
      and i.indnatts = 1 and i.indpred is null and i.indexprs is null
      and pg_get_indexdef(i.indexrelid, 1, true) = 'updated_at'
      and idx.reloptions @> array['pages_per_range=8']
  ) then
    raise exception using errcode = '55000',
      message = 'server_statistics_updated_at_brin8_idx is missing, invalid or has a conflicting definition';
  end if;
end
$guard$;

drop index concurrently if exists public.server_statistics_updated_at_brin_idx;
