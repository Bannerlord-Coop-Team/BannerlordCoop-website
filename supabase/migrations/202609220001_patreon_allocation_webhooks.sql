begin;

-- Preserve the role policy and its backpressure/retry behavior. The new seam
-- projects independently verified allocation evidence through the existing outbox.
alter table patreon_roles.sync_state add column allocation_policy jsonb;
alter function public.patreon_role_sync(text,text,text,jsonb) set schema patreon_roles;
alter function patreon_roles.patreon_role_sync(text,text,text,jsonb) rename to role_sync_without_allocations;
revoke all on function patreon_roles.role_sync_without_allocations(text,text,text,jsonb)
    from public,anon,authenticated,service_role;

create function public.patreon_role_sync(p_campaign text,p_tier text,p_operation text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    result jsonb; policy jsonb; v_evidence jsonb; fence jsonb; job jsonb;
    jobs jsonb := '[]'::jsonb; h public.membership_heads; account uuid;
begin
    perform set_config('lock_timeout',public.membership_lock_budget(),true);
    result := patreon_roles.role_sync_without_allocations(p_campaign,p_tier,p_operation,p_input);
    if result is null or result ? 'retry' or result ? 'stale' then return result; end if;
    select allocation_policy into policy from patreon_roles.sync_state where singleton;

    if p_operation = 'acquire' and p_input ? 'allocationPolicy' then
        policy := p_input->'allocationPolicy';
        if jsonb_typeof(policy) is distinct from 'object'
            or (select count(*) from jsonb_object_keys(policy)) <> 5
            or not (policy ?& array['campaignId','qualifyingTierIds','currency','minimumCents','policyVersion'])
            or policy->>'campaignId' is distinct from p_campaign
            or policy->>'currency' is distinct from 'USD'
            or policy->'minimumCents' is distinct from '5000'::jsonb
            or policy->>'policyVersion' is distinct from 'patreon-paid-usd50-v1'
            or jsonb_typeof(policy->'qualifyingTierIds') is distinct from 'array' then
            raise exception 'invalid_allocation_policy';
        end if;
        if jsonb_array_length(policy->'qualifyingTierIds') not between 1 and 50
            or exists(select 1 from jsonb_array_elements(policy->'qualifyingTierIds') t
                where jsonb_typeof(t) <> 'string' or (t #>> '{}') !~ '^[1-9][0-9]{0,31}$')
            or (select count(distinct t) from jsonb_array_elements(policy->'qualifyingTierIds') t)
                <> jsonb_array_length(policy->'qualifyingTierIds') then raise exception 'invalid_allocation_policy'; end if;
        if exists(select 1 from patreon_roles.sync_state where singleton
            and allocation_policy is not null and allocation_policy <> policy) then
            raise exception 'allocation_policy_mismatch';
        end if;
        update patreon_roles.sync_state set allocation_policy=policy where singleton;
        for job in select * from jsonb_array_elements(result->'jobs') loop
            select jsonb_build_object('accountId',head.account_id,'generation',head.link_generation::text,'revision',head.revision::text)
                into fence from patreon_roles.memberships m
                join public.patreon_accounts a on a.patreon_user_id=m.patreon_user_id
                join public.membership_heads head on head.account_id=a.user_id
                    and head.patreon_user_id=a.patreon_user_id and head.link_state='linked'
                where m.member_id=(job->>'memberId')::uuid;
            jobs := jobs || jsonb_build_array(job || jsonb_build_object('allocationFence',fence));
        end loop;
        return result || jsonb_build_object('jobs',jobs,'allocationPolicyVersion',policy->>'policyVersion',
            'allocationVerifiedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    end if;

    if p_operation <> 'complete' or not (result ? 'applied') or not (p_input ? 'allocationEvidence') then return result; end if;
    v_evidence := p_input->'allocationEvidence';
    if policy is null or jsonb_typeof(v_evidence) is distinct from 'object'
        or (select count(*) from jsonb_object_keys(v_evidence)) <> 8
        or not (v_evidence ?& array['verification','campaignId','memberId','tierIds','verifiedAt','paidThroughAt','policyVersion','evidenceSha256'])
        or v_evidence->>'policyVersion' is distinct from policy->>'policyVersion'
        or v_evidence->>'campaignId' is distinct from p_campaign
        or v_evidence->>'memberId' is distinct from p_input->>'memberId'
        or coalesce(v_evidence->>'verification','') not in ('qualifying','nonqualifying','review_required')
        or coalesce(v_evidence->>'evidenceSha256','') !~ '^[a-f0-9]{64}$'
        or coalesce(v_evidence->>'verifiedAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
        or v_evidence->'paidThroughAt' is distinct from 'null'::jsonb
        or jsonb_typeof(v_evidence->'tierIds') is distinct from 'array' then
        raise exception 'invalid_allocation_evidence';
    end if;
    if (v_evidence->>'verifiedAt')::timestamptz > clock_timestamp()
        or (v_evidence->>'verifiedAt')::timestamptz < clock_timestamp()-interval '2 minutes'
        or jsonb_array_length(v_evidence->'tierIds') > 50
        or exists(select 1 from jsonb_array_elements(v_evidence->'tierIds') t
            where jsonb_typeof(t) <> 'string' or (t #>> '{}') !~ '^[1-9][0-9]{0,31}$')
        or (select count(distinct t) from jsonb_array_elements(v_evidence->'tierIds') t) <> jsonb_array_length(v_evidence->'tierIds')
        or (v_evidence->>'verification'='qualifying' and not exists(
            select 1 from jsonb_array_elements(v_evidence->'tierIds') t where policy->'qualifyingTierIds' @> jsonb_build_array(t))) then
        raise exception 'invalid_allocation_evidence';
    end if;
    -- The current linked account is authoritative, never a caller-selected owner.
    select head.account_id into account from public.patreon_accounts a
        join public.membership_heads head on head.account_id=a.user_id
            and head.patreon_user_id=a.patreon_user_id and head.link_state='linked'
        where a.patreon_user_id=p_input->>'userId';
    if account is null then return result; end if;
    if not pg_try_advisory_xact_lock(hashtextextended(account::text,702)) then
        raise sqlstate '55P03' using message='membership_retry';
    end if;
    -- Auth deletion and the account's other mutation paths cannot interleave.
    perform 1 from auth.users where id=account and deleted_at is null
        and email_confirmed_at is not null and (banned_until is null or banned_until<=now()) for no key update nowait;
    if not found then return result; end if;
    select * into h from public.membership_heads where account_id=account for update nowait;
    fence := jsonb_build_object('accountId',h.account_id,'generation',h.link_generation::text,'revision',h.revision::text);
    if h.link_state<>'linked' or h.patreon_user_id is distinct from p_input->>'userId'
        or not exists(select 1 from public.patreon_accounts where user_id=account and patreon_user_id=h.patreon_user_id) then return result; end if;
    if p_input->'allocationFence' is distinct from fence then
        -- Newly discovered identities or changed links need a read begun AFTER
        -- the new binding. Never transfer an in-flight response to a new owner.
        update patreon_roles.memberships set due_at=now(),priority=2 where member_id=(p_input->>'memberId')::uuid;
        return result;
    end if;
    update public.membership_heads set evidence=v_evidence,revision=revision+1 where account_id=account;
    perform public.membership_notify(account,v_evidence->>'verification'<>'qualifying');
    return result;
end;
$function$;
revoke all on function public.patreon_role_sync(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.patreon_role_sync(text,text,text,jsonb) to service_role;

-- Accept the new policy without rewriting retained OAuth completion receipts.
create or replace function public.membership_complete(p_account_id uuid, p_discord_user_id text, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.patreon_oauth_states; h public.membership_heads; r public.membership_completion_receipts; result jsonb; payload text;
begin
 perform set_config('lock_timeout',public.membership_lock_budget(),true);
 perform public.membership_lock(); -- serialize outbox sequence with commit order
 if not pg_try_advisory_xact_lock(hashtextextended(p_account_id::text,702)) then raise sqlstate '55P03' using message='membership_retry'; end if;
 -- Receipt recovery does not require unexpired OAuth authority or still-positive evidence.
 select * into r from public.membership_completion_receipts where token_hash=p_token_hash;
 if found then
  if r.account_id<>p_account_id then raise exception 'Completion account conflict'; end if;
  perform public.membership_fence(p_account_id,p_discord_user_id,false);
  return r.result;
 end if;
 perform public.membership_fence(p_account_id,p_discord_user_id,false);
 select * into s from public.patreon_oauth_states where token_hash=p_token_hash and kind='complete' for update;
 if not found or s.user_id<>p_account_id or not public.membership_authority_live(s.expires_at,clock_timestamp()) or s.operation_id is null or s.evidence is null then raise exception 'Invalid completion authority'; end if;
 select * into strict h from public.membership_heads where account_id=p_account_id for update;
 if h.link_generation<>s.expected_generation then raise exception 'Link generation changed'; end if;
 if s.patreon_user_id !~ '^[1-9][0-9]{0,31}$' or jsonb_typeof(s.evidence)<>'object'
  or (select count(*) from jsonb_object_keys(s.evidence))<>8
  or not (s.evidence ?& array['verification','campaignId','memberId','tierIds','verifiedAt','paidThroughAt','policyVersion','evidenceSha256'])
  or s.evidence->>'policyVersion' not in ('patreon-paid-usd20-v1','patreon-paid-usd50-v1')
  or s.evidence->>'verification' not in ('qualifying','nonqualifying','unknown','review_required','unverified') then raise exception 'Invalid evidence'; end if;
 perform public.membership_admit(p_account_id,false);
 payload := encode(sha256(convert_to(jsonb_build_object('accountId',p_account_id,'generation',s.expected_generation,'patreonId',s.patreon_user_id,'evidence',s.evidence,'returnPath',s.return_path)::text,'UTF8')),'hex');
 if exists(select 1 from public.membership_completion_receipts where operation_id=s.operation_id) then raise exception 'Completion payload conflict'; end if;
 -- Existing tuples refuse immediately; invisible uniqueness/FK waits use the local budget.
 perform 1 from public.patreon_accounts where user_id=p_account_id or patreon_user_id=s.patreon_user_id for update nowait;
 insert into public.patreon_accounts(user_id,patreon_user_id,linked_at) values(p_account_id,s.patreon_user_id,clock_timestamp())
 on conflict(user_id) do update set patreon_user_id=excluded.patreon_user_id,linked_at=excluded.linked_at;
 update public.membership_heads set patreon_user_id=s.patreon_user_id,discord_user_id=p_discord_user_id,link_state='linked',
  link_generation=link_generation+case when patreon_user_id is distinct from s.patreon_user_id or link_state<>'linked' then 1 else 0 end,
  revision=revision+1,evidence=s.evidence where account_id=p_account_id returning * into h;
 perform public.membership_notify(p_account_id,false);
 result := jsonb_build_object('linked',true,'operationId',s.operation_id,'returnPath',s.return_path);
 insert into public.membership_completion_receipts(operation_id,account_id,token_hash,payload_sha256,result) values(s.operation_id,p_account_id,p_token_hash,payload,result);
 delete from public.patreon_oauth_states where token_hash=p_token_hash;
 return result;
end $$;

commit;
