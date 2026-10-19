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
/** These routes install sessions themselves. A refresh here could overwrite them. */
const SESSION_CALLBACKS = new Set(["/auth/callback", "/account/discord/callback", "/account/patreon/callback"]);

export async function middleware(request: NextRequest) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !publishableKey || SESSION_CALLBACKS.has(request.nextUrl.pathname)
        || !request.cookies.getAll().some(({ name }) => name.startsWith("sb-"))) return NextResponse.next();

    const written = new Map<string, { value: string; options: CookieOptions }>();
    let cacheHeaders: Record<string, string> = {};
    const impersonating = request.cookies.has(IMPERSONATION_COOKIE);
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
                },
            },
        });
        try {
            // getSession refreshes inside the SDK margin; refreshSession covers the rest of ours.
            const { data: { session } } = await client.auth.getSession();
            if (session?.expires_at !== undefined && session.expires_at - Date.now() / 1000 < REFRESH_BEFORE_EXPIRY_SECONDS) {
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
    matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
