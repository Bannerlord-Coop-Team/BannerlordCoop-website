import { assertEquals } from "jsr:@std/assert@1";
import {
  parseModDbTotalDownloads,
  parseNexusUniqueDownloads,
  parseSteamResponse,
  STEAM_WORKSHOP_ITEM_ID,
} from "../functions/_shared/platform-statistics.ts";

Deno.test("parses ModDB total downloads", () => {
  const html = `
        <div>
            File Statistics
            Files 2
            Downloads 3,595
            Downloads Today 24
        </div>
    `;

  assertEquals(parseModDbTotalDownloads(html), 3595);
});

Deno.test("does not parse ModDB profile download previews", () => {
  const html = `
        <span>3.6K Download FULL Bannerlord Coop</span>
        <span>2.2K</span>
    `;

  assertEquals(
    parseModDbTotalDownloads(html),
    null,
  );
});

Deno.test("parses Steam Workshop subscriptions", () => {
  assertEquals(
    parseSteamResponse({
      response: {
        publishedfiledetails: [{
          publishedfileid: STEAM_WORKSHOP_ITEM_ID,
          subscriptions: 65_150,
        }],
      },
    }),
    {
      publishedfileid: STEAM_WORKSHOP_ITEM_ID,
      subscriptions: 65_150,
    },
  );
});

Deno.test("rejects a different Steam Workshop item", () => {
  assertEquals(
    parseSteamResponse({
      response: {
        publishedfiledetails: [{
          publishedfileid: "1",
          subscriptions: 65_150,
        }],
      },
    }),
    null,
  );
});

Deno.test("parses Nexus unique downloads for the expected mod", () => {
  assertEquals(
    parseNexusUniqueDownloads(
      { mod_id: 42, unique_downloads: 1_234 },
      42,
    ),
    1_234,
  );
});

Deno.test("rejects Nexus downloads for a different mod", () => {
  assertEquals(
    parseNexusUniqueDownloads(
      { mod_id: 41, unique_downloads: 1_234 },
      42,
    ),
    null,
  );
});
