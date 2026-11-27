export const CONTROL_PLANE_ADMIN_MAXIMUM_RESPONSE_BYTES = 8 * 1_048_576;
export const CONTROL_PLANE_ADMIN_BROWSER_TIMEOUT_MILLISECONDS = 90_000;

export class ControlPlaneAdminError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly retryable = false,
        readonly requestId?: string,
        readonly operationId?: string,
        readonly retryAfterMilliseconds?: number,
    ) {
        super(message);
        this.name = "ControlPlaneAdminError";
    }
}

export type ControlPlaneAdminEnvelope<T> =
    | { version: 1; requestId: string; ok: true; result: T }
    | {
        version: 1;
        requestId: string;
        ok: false;
        error: { code: string; message: string; retryable: boolean; operationId?: string };
    };

export async function requestControlPlaneAdmin<T>(options: {
    accessToken: string;
    operation: string;
    input?: unknown;
    requestId?: string;
    signal?: AbortSignal;
}): Promise<T> {
    const { endpoint, publishableKey } = controlPlaneAdminEndpoint();
    const requestId = options.requestId ?? crypto.randomUUID();
    const body = JSON.stringify({
        version: 1,
        requestId,
        operation: options.operation,
        ...(options.input === undefined ? {} : { input: options.input }),
    });
    let response: Response;
    try {
        response = await fetch(endpoint, {
            method: "POST",
            headers: {
                apikey: publishableKey,
                authorization: `Bearer ${options.accessToken}`,
                "content-type": "application/json",
            },
            body,
            cache: "no-store",
            signal: options.signal
                ? AbortSignal.any([options.signal, AbortSignal.timeout(CONTROL_PLANE_ADMIN_BROWSER_TIMEOUT_MILLISECONDS)])
                : AbortSignal.timeout(CONTROL_PLANE_ADMIN_BROWSER_TIMEOUT_MILLISECONDS),
        });
    } catch {
        throw new ControlPlaneAdminError(
            "control_plane_unavailable",
            "The control plane could not be reached.",
            true,
        );
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > CONTROL_PLANE_ADMIN_MAXIMUM_RESPONSE_BYTES) {
        throw new ControlPlaneAdminError("response_too_large", "The control plane response was too large.");
    }
    return decodeControlPlaneAdminResponse<T>(text, requestId, response.ok,
        response.status === 429 ? response.headers.get("retry-after") : null);
}

export function decodeControlPlaneAdminResponse<T>(text: string, requestId: string, responseOk: boolean, retryAfter?: string | null): T {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new ControlPlaneAdminError("invalid_response", "The control plane returned an invalid response.", true);
    }
    if (!isEnvelope(parsed, requestId)) {
        const fallback = readError(parsed);
        throw new ControlPlaneAdminError(
            fallback?.code ?? "invalid_response",
            fallback?.message ?? "The control plane returned an invalid response.",
            fallback?.retryable ?? true,
            undefined,
            undefined,
            fallback?.code === "rate_limited" ? retryAfterDelay(retryAfter) : undefined,
        );
    }
    if (!parsed.ok) {
        const { code, message, retryable, operationId } = parsed.error;
        throw new ControlPlaneAdminError(code, message, retryable, responseOk ? undefined : requestId, operationId,
            code === "rate_limited" ? retryAfterDelay(retryAfter) : undefined);
    }
    return parsed.result as T;
}

const IMF_FIXDATE = /^([A-Z][a-z]{2}), (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}:\d{2}:\d{2}) GMT$/u;
const RFC850_DATE = /^([A-Z][a-z]+), (\d{2})-([A-Z][a-z]{2})-(\d{2}) (\d{2}:\d{2}:\d{2}) GMT$/u;
const ASCTIME_DATE = /^([A-Z][a-z]{2}) ([A-Z][a-z]{2}) (\d{2}| \d) (\d{2}:\d{2}:\d{2}) (\d{4})$/u;
const HTTP_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HTTP_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function retryAfterDelay(header: string | null | undefined): number | undefined {
    const value = header?.trim();
    if (!value) return undefined;
    if (/^[0-9]+$/u.test(value)) return Number(value) * 1_000;
    const now = Date.now();
    const timestamp = parseHttpDate(value, now);
    return timestamp !== undefined && timestamp > now ? timestamp - now : undefined;
}

function parseHttpDate(value: string, now: number): number | undefined {
    const gmt = IMF_FIXDATE.exec(value) ?? RFC850_DATE.exec(value);
    let parts = gmt?.slice(1);
    if (parts === undefined) {
        const asctime = ASCTIME_DATE.exec(value);
        if (asctime === null) return undefined;
        const [, weekday, month, day, time, year] = asctime;
        parts = [weekday, day, month, year, time];
    }

    const [weekday, dayText, monthText, yearText, time] = parts;
    const month = HTTP_MONTHS.indexOf(monthText);
    const day = Number(dayText);
    const [hour, minute, second] = time.split(":").map(Number);
    const leapSecond = second === 60 && hour === 23 && minute === 59;
    if (month === -1 || hour > 23 || minute > 59 || (second > 59 && !leapSecond)) return undefined;

    const shortYear = yearText.length === 2;
    const futureLimit = new Date(now);
    // RFC 850 uses the most recent matching year at or before this boundary.
    futureLimit.setUTCFullYear(futureLimit.getUTCFullYear() + 50);
    const century = shortYear ? Math.floor(futureLimit.getUTCFullYear() / 100) * 100 : 0;
    const year = century + Number(yearText);
    const date = new Date(0);
    date.setUTCFullYear(year, month, day);
    date.setUTCHours(hour, minute, Math.min(second, 59));
    const leapOffset = leapSecond ? 1_000 : 0;
    if (shortYear && date.getTime() + leapOffset > futureLimit.getTime()) date.setUTCFullYear(year - 100, month, day);

    const dayName = HTTP_WEEKDAYS[date.getUTCDay()];
    if (date.getUTCMonth() !== month || date.getUTCDate() !== day
        || weekday !== (shortYear ? dayName : dayName.slice(0, 3))) return undefined;
    return date.getTime() + leapOffset;
}

function controlPlaneAdminEndpoint() {
    const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
    if (!raw || !publishableKey) throw new ControlPlaneAdminError(
        "control_plane_not_configured",
        "Supabase is not configured.",
    );
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.pathname !== "/") {
        throw new ControlPlaneAdminError("control_plane_not_configured", "The Supabase URL must be an HTTPS origin.");
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new ControlPlaneAdminError("control_plane_not_configured", "The Supabase URL is invalid.");
    }
    if (publishableKey.length < 20 || publishableKey.length > 4_096) {
        throw new ControlPlaneAdminError("control_plane_not_configured", "The Supabase key is invalid.");
    }
    url.pathname = "/functions/v1/control-plane-admin";
    return { endpoint: url, publishableKey };
}

function isEnvelope(value: unknown, requestId: string): value is ControlPlaneAdminEnvelope<unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (record.version !== 1 || record.requestId !== requestId || typeof record.ok !== "boolean") return false;
    if (record.ok) return Object.hasOwn(record, "result");
    const error = readError(value);
    return error !== null;
}

function readError(value: unknown): { code: string; message: string; retryable: boolean; operationId?: string } | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const candidate = (value as Record<string, unknown>).error;
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return null;
    const error = candidate as Record<string, unknown>;
    if (error.operationId !== undefined && typeof error.operationId !== "string") return null;
    return typeof error.code === "string" && typeof error.message === "string"
        ? { code: error.code, message: error.message, retryable: error.retryable === true,
            ...(error.operationId === undefined ? {} : { operationId: error.operationId }) }
        : null;
}
