BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Confirmed paid-access loss may keep the member's remaining paid tiers below the policy
-- minimum. Each validator drops only its empty-tierIds clause from its CURRENT definition;
-- nonqualifying and paidAccessEndedAt <= verifiedAt (Patreon: equal) are unchanged.
-- A definition without exactly one such clause aborts the migration.
do $migration$
declare patch record; definition text;
begin
    for patch in select * from (values
        ('public.patreon_role_sync(text,text,text,jsonb)'::regprocedure, $c$or v_evidence->'tierIds' is distinct from '[]'::jsonb$c$),
        ('boosty_membership.valid_evidence(jsonb,text)'::regprocedure, $c$ and e->'tierIds'='[]'::jsonb$c$)
    ) as p(fn, clause) loop
        definition := pg_get_functiondef(patch.fn);
        if (length(definition) - length(replace(definition, patch.clause, ''))) <> length(patch.clause) then
            raise exception 'unexpected definition of %', patch.fn;
        end if;
        execute replace(definition, patch.clause, '');
    end loop;
end
$migration$;

COMMIT;
