begin;

create function nightly_gateway.enforce_sponsorship_limit()
returns trigger
language plpgsql
set search_path = pg_catalog, nightly_gateway
as $function$
begin
    -- Serialize claims for one sponsor so concurrent requests cannot both
    -- observe the tenth seat as available.
    perform pg_advisory_xact_lock(hashtextextended(new.supporter_discord_user_id, 773413652));
    if (
        select count(*) >= 10
        from nightly_gateway.sponsorships
        where supporter_discord_user_id = new.supporter_discord_user_id
    ) then
        return null;
    end if;
    return new;
end;
$function$;

revoke all on function nightly_gateway.enforce_sponsorship_limit() from public, anon, authenticated;
grant execute on function nightly_gateway.enforce_sponsorship_limit() to nightly_gateway_runtime;

create trigger enforce_sponsorship_limit
before insert on nightly_gateway.sponsorships
for each row execute function nightly_gateway.enforce_sponsorship_limit();

commit;
