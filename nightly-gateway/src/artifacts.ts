import { isAllowedArtifactKey } from "./artifact-keys";
import { isAllowedPinClientKey } from "./pin-rules";
import type { RequestEnv } from "./database";
import { authorizeDownload } from "./downloads";
import { GatewayError } from "./http";

// Streams one authorized R2 artifact, honouring range and conditional request headers.
export async function serveArtifact(request: Request, env: RequestEnv, encodedKey: string): Promise<Response> {
    const authorization = await authorizeDownload(request, env.DB);
    let key: string;
    try {
        key = encodedKey.split("/").map(decodeURIComponent).join("/");
    } catch {
        throw new GatewayError(400, "invalid_artifact");
    }
    if (authorization.kind === "pin") {
        if (!isAllowedPinClientKey(key, authorization.buildId)) throw new GatewayError(400, "invalid_artifact");
    } else if (!isAllowedArtifactKey(key) || key.endsWith(".json")) {
        throw new GatewayError(400, "invalid_artifact");
    }
    const object = await env.RELEASES.get(key, { range: request.headers, onlyIf: request.headers });
    if (object === null) throw new GatewayError(404, "artifact_unavailable");
    const headers = new Headers({
        "cache-control": "private, no-store",
        "accept-ranges": "bytes",
        "x-content-type-options": "nosniff",
    });
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    if (!("body" in object)) return new Response(null, { status: 412, headers });
    if (object.range) {
        const offset = "suffix" in object.range ? object.size - object.range.suffix : (object.range.offset ?? 0);
        const length = "suffix" in object.range
            ? object.range.suffix
            : (object.range.length ?? object.size - offset);
        headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
        headers.set("content-length", String(length));
        return new Response(object.body, { status: 206, headers });
    }
    headers.set("content-length", String(object.size));
    return new Response(object.body, { status: 200, headers });
}
