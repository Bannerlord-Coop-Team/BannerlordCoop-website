import { createServerClient, serializeCookieHeader, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE_OPTIONS, IMPERSONATION_COOKIE } from "./app/lib/auth/impersonation-cookie-options";

// Next 16 renamed middleware to proxy, but proxy.ts runs only on Node.js, which
// OpenNext Cloudflare supports only experimentally. Edge middleware is supported.

/**
 * Refresh well before the SDK's own 90 s margin. A refresh inside a server action
 * writes cookies, and Next then re-renders the whole page in the action response.
 */
const REFRESH_BEFORE_EXPIRY_SECONDS = 5 * 60;
/**
 * Route handlers set cookies without re-rendering anything, so they refresh for
 * themselves and keep their own headers. The OAuth callbacks also install sessions
 * that a refresh here would overwrite.
 */
const ROUTE_HANDLER = /^\/(?:api\/|auth\/callback$|account\/(?:discord|patreon)\/callback$)/u;

export async function middleware(request: NextRequest) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const impersonating = request.cookies.has(IMPERSONATION_COOKIE);
    if (!url || !publishableKey || ROUTE_HANDLER.test(request.nextUrl.pathname)
        || (!impersonating && !request.cookies.getAll().some(({ name }) => name.startsWith("sb-")))) return NextResponse.next();

    const written = new Map<string, { value: string; options: CookieOptions }>();
    let cacheHeaders: Record<string, string> = {};
    let writes = 0;
    for (const cookieOptions of impersonating ? [undefined, ADMIN_SESSION_COOKIE_OPTIONS] : [undefined]) {
        const client = createServerClient(url, publishableKey, {
            ...(cookieOptions ? { cookieOptions } : {}),
            cookies: {
                getAll() { return request.cookies.getAll(); },
                setAll(cookies, headers) {
                    for (const { name, value, options } of cookies) {
                        // Pages and actions read the forwarded values and find nothing left to refresh.
                        if (value) request.cookies.set(name, value);
                        else request.cookies.delete(name);
                        written.set(name, { value, options });
                    }
                    cacheHeaders = { ...cacheHeaders, ...headers };
                    writes += 1;
                },
            },
        });
        try {
            // getSession refreshes inside the SDK margin; refreshSession covers the rest of ours,
            // once per request even if the token lifetime is configured shorter than both.
            const before = writes;
            const { data: { session } } = await client.auth.getSession();
            if (writes === before && session?.expires_at !== undefined && session.expires_at - Date.now() / 1000 < REFRESH_BEFORE_EXPIRY_SECONDS) {
                await client.auth.refreshSession();
            }
        } catch { /* Pages and actions authenticate independently and can still refresh. */ }
    }
    if (written.size === 0) return NextResponse.next();

    const response = NextResponse.next({ request: { headers: request.headers } });
    // Not response.cookies: Next copies those into a server action's cookie store,
    // which marks the page revalidated and re-renders it anyway.
    for (const [name, { value, options }] of written) response.headers.append("set-cookie", serializeCookieHeader(name, value, options));
    for (const [name, value] of Object.entries(cacheHeaders)) response.headers.set(name, value);
    return response;
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|ttf|mp4|webm|txt|xml|webmanifest)$).*)"],
};
