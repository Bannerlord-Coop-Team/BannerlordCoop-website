BEGIN;

create or replace function public.membership_fence(p_account_id uuid, p_discord_user_id text, p_deleted boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h public.membership_heads; current_patreon text; state text;
begin
 perform set_config('lock_timeout',public.membership_lock_budget(),true);
 perform public.membership_lock(); -- no cursor can skip an uncommitted lower sequence
 if not pg_try_advisory_xact_lock(hashtextextended(p_account_id::text, 702)) then raise sqlstate '55P03' using message='membership_retry'; end if;
 insert into public.membership_heads(account_id) values(p_account_id) on conflict do nothing;
 select * into strict h from public.membership_heads where account_id=p_account_id for update;
 if p_deleted then current_patreon := null; state := 'account_deleted';
 else
  if h.link_state='account_deleted' then raise exception 'Deleted account cannot be resurrected'; end if;
  select patreon_user_id into current_patreon from public.patreon_accounts where user_id=p_account_id;
  state := case when current_patreon is null then 'unlinked' else h.link_state end;
  if current_patreon is not null and h.patreon_user_id is distinct from current_patreon then state := 'identity_changed'; end if;
 end if;
 if h.patreon_user_id is distinct from current_patreon or h.link_state is distinct from state then
  update public.membership_heads set discord_user_id=case when p_deleted then null else p_discord_user_id end, patreon_user_id=current_patreon,
   link_generation=link_generation+1, revision=revision+1, link_state=state, evidence=public.membership_empty_evidence()
   where account_id=p_account_id returning * into h;
  perform public.membership_notify(p_account_id,true);
 elsif h.discord_user_id is distinct from p_discord_user_id then
  -- Optional profile metadata changes never invalidate paid membership evidence.
  update public.membership_heads set discord_user_id=p_discord_user_id, revision=revision+1
   where account_id=p_account_id returning * into h;
  perform public.membership_notify(p_account_id,false);
 end if;
 return public.membership_snapshot_json(h);
end $$;

COMMIT;
