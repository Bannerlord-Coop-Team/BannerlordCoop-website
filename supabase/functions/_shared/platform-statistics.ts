export const STEAM_WORKSHOP_ITEM_ID = "3770450698";

export type SteamPublishedFile = {
  publishedfileid: string;
  subscriptions: number;
};

export function parseSteamResponse(value: unknown): SteamPublishedFile | null {
  if (!isRecord(value) || !isRecord(value.response)) return null;

  const details = value.response.publishedfiledetails;

  if (!Array.isArray(details) || details.length !== 1) return null;

  const publishedFile = details[0];

  if (
    !isRecord(publishedFile) ||
    publishedFile.publishedfileid !== STEAM_WORKSHOP_ITEM_ID ||
    !isNonNegativeInteger(publishedFile.subscriptions)
  ) {
    return null;
  }

  return {
    publishedfileid: publishedFile.publishedfileid,
    subscriptions: publishedFile.subscriptions,
  };
}

export function parseNexusUniqueDownloads(
  value: unknown,
  expectedModId: number,
): number | null {
  if (
    !isRecord(value) ||
    value.mod_id !== expectedModId ||
    !isNonNegativeInteger(value.unique_downloads)
  ) {
    return null;
  }

  return value.unique_downloads;
}

export function parseModDbTotalDownloads(html: string): number | null {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  const match = text.match(
    /\bDownloads\s+([0-9][0-9,]*)\s+Downloads Today\b/i,
  );

  if (!match) return null;

  const downloads = Number(match[1].replace(/,/g, ""));
  return isNonNegativeInteger(downloads) ? downloads : null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}
