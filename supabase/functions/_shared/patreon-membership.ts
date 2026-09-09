import { IDENTIFIER, UUID, POLICY_VERSION, record, sha256, type Evidence, type Policy } from "./membership.ts";

export const PATREON_IDENTITY_URL = (() => {
    const url = new URL("https://www.patreon.com/api/oauth2/v2/identity");
    url.searchParams.set("include", "memberships.campaign,memberships.currently_entitled_tiers.campaign,memberships.user");
    url.searchParams.set("fields[member]", "patron_status,last_charge_status,last_charge_date,currently_entitled_amount_cents,is_free_trial,is_gifted");
    url.searchParams.set("fields[campaign]", "currency");
    url.searchParams.set("fields[tier]", "amount_cents");
    return url.href;
})();
// Patreon member IDs are UUIDs; user, campaign and tier IDs remain numeric.
function resourceId(type: string, id: string): boolean {
    return type === "member" ? UUID.test(id) : ["user", "campaign", "tier"].includes(type) && IDENTIFIER.test(id);
}
function resource(value: unknown, type: string): value is Record<string, unknown> & { id: string } { return record(value) && value.type === type && typeof value.id === "string" && resourceId(type, value.id); }
// Accept only a complete bounded response; never follow provider pagination URLs.
function completePagination(value: Record<string, unknown>, count: number): void {
    if (value.links !== undefined) {
        if (!record(value.links) || (value.links.next !== undefined && value.links.next !== null) || (value.links.prev !== undefined && value.links.prev !== null)) throw new Error("Incomplete links");
    }
    if (value.meta === undefined) return;
    if (!record(value.meta)) throw new Error("Invalid metadata");
    if (value.meta.pagination === undefined) return;
    const page = value.meta.pagination;
    if (!record(page) || (!Object.hasOwn(page, "total") && !Object.hasOwn(page, "cursors"))) throw new Error("Invalid pagination");
    if (page.total !== undefined && (!Number.isSafeInteger(page.total) || page.total !== count)) throw new Error("Contradictory total");
    if (page.cursors !== undefined) {
        if (!record(page.cursors) || !Object.hasOwn(page.cursors, "next") || page.cursors.next !== null) throw new Error("Incomplete cursors");
        if (page.cursors.prev !== undefined && page.cursors.prev !== null) throw new Error("Partial page");
    }
    // Unrecognized pagination semantics cannot establish completeness.
    if (Object.keys(page).some(key => !["total", "cursors"].includes(key))) throw new Error("Unknown pagination");
}
function relationship(value: Record<string, unknown>, name: string): unknown {
    if (!record(value.relationships) || !record(value.relationships[name])) throw new Error("Missing relationship");
    const relation = value.relationships[name];
    completePagination(relation, Array.isArray(relation.data) ? relation.data.length : relation.data === null ? 0 : 1);
    return relation.data;
}
// This is current subscription-benefit evidence, NOT proof of a settled $20 charge.
// Patreon documents entitled tiers/amount as including a current pledge. An upgrade
// already reported entitled with active_patron + Paid deliberately qualifies.
export async function verifyPatreonMembership(body: unknown, policy: Policy | null, now = new Date().toISOString()): Promise<{ patreonUserId: string; evidence: Evidence }> {
    if (!record(body) || !resource(body.data, "user")) throw new Error("Invalid Patreon identity");
    const user = body.data;
    const evidence: Evidence = { verification: policy === null ? "unverified" : "review_required", campaignId: policy?.campaignId ?? null, memberId: null, tierIds: [], verifiedAt: policy === null ? null : now, paidThroughAt: null, policyVersion: POLICY_VERSION, evidenceSha256: null };
    if (policy !== null) {
        try {
            completePagination(body, 1);
            if (!Array.isArray(body.included) || body.included.length > 500) throw new Error("Incomplete resources");
            const included = new Map<string, Record<string, unknown>>();
            for (const item of body.included) {
                if (!record(item) || typeof item.type !== "string" || typeof item.id !== "string" || !resourceId(item.type, item.id)) throw new Error("Invalid resource");
                const key = `${item.type}:${item.id}`; if (included.has(key)) throw new Error("Duplicate resource"); included.set(key, item);
            }
            const memberships = relationship(user, "memberships");
            if (!Array.isArray(memberships) || memberships.length > 100) throw new Error("Incomplete memberships");
            const seen = new Set<string>(); const candidates: Record<string, unknown>[] = [];
            for (const ref of memberships) {
                if (!resource(ref, "member") || seen.has(ref.id)) throw new Error("Ambiguous member"); seen.add(ref.id);
                const member = included.get(`member:${ref.id}`); if (!member) throw new Error("Missing member");
                const owner = relationship(member, "user"); if (!resource(owner, "user") || owner.id !== user.id) throw new Error("Wrong member identity");
                const campaign = relationship(member, "campaign"); if (!resource(campaign, "campaign")) throw new Error("Missing campaign");
                if (campaign.id === policy.campaignId) candidates.push(member);
            }
            if (candidates.length === 0) evidence.verification = "nonqualifying";
            else {
                if (candidates.length !== 1) throw new Error("Ambiguous campaign membership");
                const member = candidates[0]; evidence.memberId = member.id as string;
                const campaign = included.get(`campaign:${policy.campaignId}`);
                if (!campaign || !record(campaign.attributes) || campaign.attributes.currency !== "USD") throw new Error("Unsupported currency");
                const tiers = relationship(member, "currently_entitled_tiers");
                if (!Array.isArray(tiers) || tiers.length > 50) throw new Error("Incomplete entitled tiers");
                const tierIds: string[] = [];
                for (const ref of tiers) {
                    if (!resource(ref, "tier") || tierIds.includes(ref.id)) throw new Error("Ambiguous tier");
                    const tier = included.get(`tier:${ref.id}`);
                    // Require both the provider tier/campaign relationship and reviewed mapping.
                    if (!tier || !record(tier.attributes) || !Number.isSafeInteger(tier.attributes.amount_cents) || (tier.attributes.amount_cents as number) < 0) throw new Error("Missing tier amount");
                    const tierCampaign = relationship(tier, "campaign");
                    if (!resource(tierCampaign, "campaign") || tierCampaign.id !== policy.campaignId) throw new Error("Tier belongs to another campaign");
                    if (policy.qualifyingTierIds.includes(ref.id) && (tier.attributes.amount_cents as number) < 2000) throw new Error("Policy mapping disagrees with provider");
                    tierIds.push(ref.id);
                }
                evidence.tierIds = tierIds.sort();
                const a = member.attributes;
                if (!record(a) || !Number.isSafeInteger(a.currently_entitled_amount_cents) || (a.currently_entitled_amount_cents as number) < 0 || typeof a.last_charge_date !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/u.test(a.last_charge_date) || !Number.isFinite(Date.parse(a.last_charge_date)) || new Date(a.last_charge_date).toISOString().slice(0,19) !== a.last_charge_date.slice(0,19) || Date.parse(a.last_charge_date) > Date.parse(now) || a.is_free_trial !== false || a.is_gifted !== false) throw new Error("Missing payment/status evidence");
                if (a.patron_status === "declined_patron" || a.last_charge_status === "Declined") evidence.verification = "nonqualifying";
                else if (a.patron_status !== "active_patron" || a.last_charge_status !== "Paid") evidence.verification = "review_required";
                else evidence.verification = tierIds.some(id => policy.qualifyingTierIds.includes(id)) && (a.currently_entitled_amount_cents as number) >= 2000 ? "qualifying" : "nonqualifying";
            }
        } catch { evidence.verification = "review_required"; }
        // Only normalized evidence is retained, never raw provider bodies or credentials.
        evidence.evidenceSha256 = await sha256(JSON.stringify({ patreonUserId: user.id, ...evidence }));
    }
    return { patreonUserId: user.id, evidence };
}
