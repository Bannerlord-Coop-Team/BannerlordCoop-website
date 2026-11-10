import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { BoostyConnection } from "@/app/account/BoostyConnection";
import { BOOSTY_CODE_COOKIE, boostyLinkingEnabled, readBoostyLinkStatus } from "@/app/lib/hosting/boosty-link";
import type { getSupabaseServerClient } from "@/app/lib/supabase/server";
import type { Translator } from "@/app/lib/localization/types";
import type { BoostyLinkStatus } from "../../../supabase/functions/_shared/boosty-account";
import { FUNDING_PROVIDERS, type FundingProvider } from "../../../supabase/functions/_shared/funding-provider";

/** What a funding provider's account section needs to load its status and render. */
export type FundingSectionContext = {
    supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>; accountId: string; result: string | undefined;
    t: Translator["t"]; buttonClass: string;
};
/** Loads and renders one provider's account section; null hides it rather than guessing its state. */
export type FundingAccountSection = (context: FundingSectionContext) => Promise<ReactNode | null>;
/** Funding providers with their own account section; Patreon's is the page's legacy membership block. */
export type SectionProvider = Exclude<FundingProvider, "patreon">;

/** Boosty's section: only when linking is enabled and the Edge reports it configured; any failure hides it. */
async function boostySection({ supabase, accountId, result, t, buttonClass }: FundingSectionContext): Promise<ReactNode | null> {
    if (!boostyLinkingEnabled()) return null;
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || session.user.id !== accountId) return null;
        const code = (await cookies()).get(BOOSTY_CODE_COOKIE)?.value;
        const status: BoostyLinkStatus = await readBoostyLinkStatus(supabase, session.access_token, code);
        if (!status.configured) return null;
        return <BoostyConnection accountId={accountId} status={status} code={code ?? null} result={result} t={t} buttonClass={buttonClass} />;
    } catch { return null; }
}

// The account-surface registry: every non-Patreon funding provider is one entry, a compile error when missing.
const FUNDING_ACCOUNT_SECTIONS: Record<SectionProvider, FundingAccountSection> = { boosty: boostySection };
/** Section providers in registry order; each also owns the `?<provider>=` result parameter. */
export const SECTION_PROVIDERS = FUNDING_PROVIDERS.filter((provider): provider is SectionProvider => provider !== "patreon");

/** Loads every provider section for one request, in provider order, keyed for rendering. */
export async function loadFundingSections(context: Omit<FundingSectionContext, "result">, results: Partial<Record<SectionProvider, string>>) {
    return Promise.all(SECTION_PROVIDERS.map(async provider => ({ provider, node: await FUNDING_ACCOUNT_SECTIONS[provider]({ ...context, result: results[provider] }) })));
}
