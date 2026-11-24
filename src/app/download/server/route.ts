import { createReleaseDownloadHandler } from "@/app/lib/releases/server";

export const dynamic = "force-dynamic";

/** `GET /download/server`: 302 to the newest public release's Windows dedicated server archive. */
export const GET = createReleaseDownloadHandler("server");
