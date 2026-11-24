import { createReleaseDownloadHandler } from "@/app/lib/releases/server";

export const dynamic = "force-dynamic";

/** `GET /download/mod`: 302 to the newest public release's mod archive. */
export const GET = createReleaseDownloadHandler("mod");
