import type {
    HostingPage,
    MyServerSummary,
} from "@/app/lib/control-plane/types";

const MAXIMUM_RESPONSE_BYTES = 8 * 1_048_576;
const MAXIMUM_PAGES = 10;

export class MyServersApiError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly retryable = false,
    ) {
        super(message);
        this.name = "MyServersApiError";
    }
}

export async function listAllMyServers(accessToken: string): Promise<MyServerSummary[]> {
    const servers: MyServerSummary[] = [];
    const seenIds = new Set<string>();
    let cursor: string | null = null;

    for (let pageIndex = 0; pageIndex < MAXIMUM_PAGES; pageIndex += 1) {
        const result = parseServerPage(await requestMyServers(accessToken, cursor));
        for (const server of result.items) {
            if (seenIds.has(server.serverId)) {
                throw invalidResponse("The server API returned a duplicate server.");
            }
            seenIds.add(server.serverId);
            servers.push(server);
        }
        if (result.nextCursor === null) return servers;
        cursor = result.nextCursor;
    }

    throw new MyServersApiError(
        "response_too_large",
        "The server inventory exceeds the supported page limit.",
    );
}

async function requestMyServers(accessToken: string, cursor: string | null): Promise<unknown> {
    const { endpoint, publishableKey } = myServersEndpoint();
    const requestId = crypto.randomUUID();
    endpoint.searchParams.set("limit", "100");
    if (cursor !== null) endpoint.searchParams.set("cursor", cursor);

    let response: Response;
    try {
        response = await fetch(endpoint, {
            method: "GET",
            headers: {
                accept: "application/json",
                apikey: publishableKey,
                authorization: `Bearer ${accessToken}`,
                "x-request-id": requestId,
            },
            cache: "no-store",
            signal: AbortSignal.timeout(30_000),
        });
    } catch {
        throw new MyServersApiError(
            "server_api_unavailable",
            "The managed-server API could not be reached.",
            true,
        );
    }

    const text = await readBoundedText(response, MAXIMUM_RESPONSE_BYTES);
    let envelope: unknown;
    try {
        envelope = JSON.parse(text);
    } catch {
        throw invalidResponse();
    }
    if (!isRecord(envelope) || envelope.version !== 1 || envelope.requestId !== requestId || typeof envelope.ok !== "boolean") {
        throw invalidResponse();
    }
    if (!envelope.ok) {
        const error = envelope.error;
        if (!isRecord(error) || typeof error.code !== "string" || typeof error.message !== "string") {
            throw invalidResponse();
        }
        throw new MyServersApiError(error.code, error.message, error.retryable === true);
    }
    if (!response.ok || !Object.hasOwn(envelope, "result")) throw invalidResponse();
    return envelope.result;
}

function myServersEndpoint() {
    const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
    if (!rawUrl || !publishableKey) {
        throw new MyServersApiError("server_api_not_configured", "The managed-server API is not configured.");
    }
    const endpoint = new URL(rawUrl);
    if (endpoint.protocol !== "https:" || endpoint.pathname !== "/" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
        throw new MyServersApiError("server_api_not_configured", "The Supabase URL is invalid.");
    }
    if (publishableKey.length < 20 || publishableKey.length > 4_096) {
        throw new MyServersApiError("server_api_not_configured", "The Supabase publishable key is invalid.");
    }
    endpoint.pathname = "/functions/v1/my-servers";
    return { endpoint, publishableKey };
}

function parseServerPage(value: unknown): HostingPage<MyServerSummary> {
    if (!isRecord(value) || !Array.isArray(value.items)) throw invalidResponse();
    if (value.nextCursor !== null && typeof value.nextCursor !== "string") throw invalidResponse();
    return {
        items: value.items as MyServerSummary[],
        nextCursor: value.nextCursor as string | null,
    };
}

async function readBoundedText(response: Response, maximumBytes: number) {
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null && Number(declaredLength) > maximumBytes) {
        throw new MyServersApiError("response_too_large", "The server API response was too large.");
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximumBytes) {
        throw new MyServersApiError("response_too_large", "The server API response was too large.");
    }
    return text;
}

function invalidResponse(message = "The managed-server API returned an invalid response.") {
    return new MyServersApiError("invalid_response", message, true);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
