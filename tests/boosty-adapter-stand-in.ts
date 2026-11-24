/** SQL stand-ins for the Boosty adapter functions the price-and-loss-breaker migration rewrites, for suites that do not install the adapter. */
export const BOOSTY_ADAPTER_STAND_IN = `create schema boosty_membership;
    create function boosty_membership.valid_evidence(e jsonb, p_blog text) returns boolean language sql as $$ select true and e->'tierIds'='[]'::jsonb $$;
    create function boosty_membership.linked(p_input jsonb) returns jsonb language sql as $$ select null::jsonb -- 'linkGeneration',h.link_generation::text,
    $$;`;
