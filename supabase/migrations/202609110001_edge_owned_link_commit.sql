begin;

-- Forward-only cutover: deploy the callback/Edge consumers together with this migration.
-- Auth owns Discord linking separately. These RPCs commit only website membership state.
-- Unconfirmed pre-cutover Discord attempts must reauthorize; never infer PKCE authority.
delete from public.discord_link_requests where confirmed_at is null;

create or replace function public.membership_begin(p_account_id uuid, p_discord_user_id text, p_operation_id uuid, p_token_hash text, p_return_path text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare snapshot jsonb;
begin
 perform set_config('lock_timeout',public.membership_lock_budget(),true);
 snapshot := public.membership_fence(p_account_id,p_discord_user_id,false);
 perform public.membership_admit(p_account_id,true);
 -- A new explicit authorization supersedes every older Patreon generation.
 update public.membership_heads set evidence=public.membership_empty_evidence() || '{"verification":"unknown"}'::jsonb, link_generation=link_generation+1, revision=revision+1 where account_id=p_account_id;
 select public.membership_snapshot_json(h) into snapshot from public.membership_heads h where account_id=p_account_id;
 perform public.membership_notify(p_account_id,false);
 insert into public.patreon_oauth_states(token_hash,kind,user_id,expires_at,operation_id,expected_generation,return_path)
 values(p_token_hash,'ticket',p_account_id,clock_timestamp()+interval '10 minutes',p_operation_id,(snapshot->>'linkGeneration')::bigint,p_return_path);
 return jsonb_build_object('started',true);
end $$;

create or replace function public.membership_discord_begin(p_account_id uuid,p_token_hash text,p_operation_id uuid,p_return_path text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 perform set_config('lock_timeout',public.membership_lock_budget(),true);
 perform public.membership_fence(p_account_id,null,false);
 -- New explicit attempts supersede unfinished authority, never confirmed receipts.
 delete from public.discord_link_requests where account_id=p_account_id and confirmed_at is null;
 perform public.membership_admit(p_account_id,true);
 -- Before attestation callback_generation is the initiating generation; afterwards
 -- it is the generation fenced to the exact Discord identity verified by PKCE.
 insert into public.discord_link_requests(token_hash,operation_id,account_id,return_path,expires_at,callback_generation)
 select p_token_hash,p_operation_id,p_account_id,p_return_path,clock_timestamp()+interval '10 minutes',link_generation
 from public.membership_heads where account_id=p_account_id;
 return jsonb_build_object('started',true);
end $$;

create or replace function public.membership_discord_check(p_account_id uuid,p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 perform set_config('lock_timeout',public.membership_lock_budget(),true);
 if not exists(select 1 from public.discord_link_requests r join public.membership_heads h using(account_id)
  where r.token_hash=p_token_hash and r.account_id=p_account_id and r.expires_at>clock_timestamp()
   and r.confirmed_at is null and r.callback_generation=h.link_generation) then raise exception 'Discord initiation mismatch'; end if;
 return jsonb_build_object('valid',true);
end $$;

-- Only the website server may attest successful same-account PKCE, never a public
-- JWT endpoint inferring callback success from an already-linked Auth identity.
create or replace function public.membership_discord_callback(p_account_id uuid,p_token_hash text,p_discord_user_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.discord_link_requests; h public.membership_heads;
begin
 perform set_config('lock_timeout',public.membership_lock_budget(),true);
 perform public.membership_lock();
 if not pg_try_advisory_xact_lock(hashtextextended(p_account_id::text,702)) then raise sqlstate '55P03' using message='membership_retry'; end if;
 select * into r from public.discord_link_requests where token_hash=p_token_hash for update;
 if not found or r.account_id<>p_account_id or not public.membership_authority_live(r.expires_at,clock_timestamp()) or r.confirmed_at is not null
  or p_discord_user_id is null or p_discord_user_id !~ '^[0-9]{17,20}$'
  then raise exception 'Invalid callback'; end if;
 if not exists(select 1 from public.membership_heads where account_id=p_account_id and link_generation=r.callback_generation)
  then raise exception 'Callback superseded'; end if;
 if r.callback_discord_id is not null then
  if r.callback_discord_id<>p_discord_user_id then raise exception 'Callback conflict'; end if;
 else
  perform public.membership_fence(p_account_id,p_discord_user_id,false);
  select * into strict h from public.membership_heads where account_id=p_account_id;
  update public.discord_link_requests set callback_discord_id=p_discord_user_id,callback_generation=h.link_generation where token_hash=p_token_hash;
 end if;
 return jsonb_build_object('verified',true);
end $$;

create or replace function public.membership_discord_confirm(p_account_id uuid,p_token_hash text,p_discord_user_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.discord_link_requests;
begin
 perform set_config('lock_timeout',public.membership_lock_budget(),true);
 perform public.membership_lock();
 if not pg_try_advisory_xact_lock(hashtextextended(p_account_id::text,702)) then raise sqlstate '55P03' using message='membership_retry'; end if;
 select * into r from public.discord_link_requests where token_hash=p_token_hash for update;
 if not found or r.account_id<>p_account_id or p_discord_user_id is null
  or (r.confirmed_discord_id is not null and r.confirmed_discord_id<>p_discord_user_id) then raise exception 'Discord linking conflict'; end if;
 -- Exact historical receipts never reapply an Auth link or website membership.
 if r.confirmed_at is not null then
  perform public.membership_fence(p_account_id,p_discord_user_id,false);
  return jsonb_build_object('confirmed',true,'returnPath',r.return_path);
 end if;
 if not public.membership_authority_live(r.expires_at,clock_timestamp()) or r.callback_discord_id is distinct from p_discord_user_id
  or not exists(select 1 from public.membership_heads where account_id=p_account_id and link_generation=r.callback_generation)
  then raise exception 'Invalid Discord callback authority'; end if;
 perform public.membership_admit(p_account_id,false);
 perform public.membership_fence(p_account_id,p_discord_user_id,false);
 update public.discord_link_requests set confirmed_discord_id=p_discord_user_id,confirmed_at=clock_timestamp()
  where token_hash=p_token_hash and account_id=p_account_id and operation_id=r.operation_id
   and confirmed_at is null and expires_at=r.expires_at and public.membership_authority_live(expires_at,clock_timestamp())
  returning * into r;
 if not found or not public.membership_authority_live(r.expires_at,r.confirmed_at) then raise exception 'Discord confirmation expired or missing'; end if;
 return jsonb_build_object('confirmed',true,'returnPath',r.return_path);
end $$;

-- No CASCADE: an unexpected dependency must fail the migration, not disappear.
drop trigger membership_completion_intent on public.patreon_oauth_states;
drop function public.membership_completion_intent();
drop function public.membership_recovery(uuid,text,text,uuid,boolean,text);
drop table public.membership_recovery_intents;
-- CREATE OR REPLACE preserves existing service-only execution grants.

commit;
