import { MyServersApiError, requestMyServersApi } from "./my-servers";
import {
    parseCampaignPage,
    parseCampaignResetResult,
    parseCampaignSelection,
    type CampaignMutation,
    type CampaignPage,
    type CampaignResetResult,
    type CampaignSelection,
    type CampaignSummary,
} from "../../../../supabase/functions/_shared/server-campaign-contract";

const PAGE_LIMIT = 50;
const MAXIMUM_PAGES = 4;

/** Every campaign registered for the server plus the current selection, newest first. */
export async function listMyServerCampaigns(accessToken: string, serverId: string): Promise<Omit<CampaignPage, "nextCursor">> {
    const items: CampaignSummary[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    let head: CampaignPage | null = null;
    for (let page = 0; page < MAXIMUM_PAGES; page += 1) {
        const current: CampaignPage = parseCampaignPage(await requestMyServersApi(accessToken, {
            method: "GET",
            configureEndpoint(url) {
                url.searchParams.set("resource", "saves");
                url.searchParams.set("serverId", serverId);
                url.searchParams.set("limit", String(PAGE_LIMIT));
                if (cursor !== null) url.searchParams.set("cursor", cursor);
            },
        }));
        if (current.serverId !== serverId) throw new Error("Campaign page belongs to another server");
        head ??= current;
        for (const item of current.items) {
            if (seen.has(item.saveId)) throw new Error("Duplicate campaign");
            seen.add(item.saveId); items.push(item);
        }
        if (current.nextCursor === null) return { serverId, updatedAt: head.updatedAt, activeSaveId: head.activeSaveId, items };
        cursor = current.nextCursor;
    }
    throw new MyServersApiError("response_too_large", "The campaign list exceeds the supported page limit.");
}

export async function selectMyServerCampaign(accessToken: string, requestId: string, input: Extract<CampaignMutation, { action: "select-save" }>): Promise<CampaignSelection> {
    const selection = parseCampaignSelection(await requestMyServersApi(accessToken, { method: "POST", body: JSON.stringify(input), requestId }));
    if (selection.serverId !== input.serverId) throw new Error("Campaign selection belongs to another server");
    return selection;
}

export async function resetMyServerCampaign(accessToken: string, requestId: string, input: Extract<CampaignMutation, { action: "reset-campaign" }>): Promise<CampaignResetResult> {
    return parseCampaignResetResult(await requestMyServersApi(accessToken, { method: "POST", body: JSON.stringify(input), requestId }));
}
