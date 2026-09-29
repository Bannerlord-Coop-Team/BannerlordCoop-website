import { request as httpsRequest } from "node:https";
import { createServerClient } from "@supabase/ssr";
import { fixture } from "./seed-auth.mjs";

const authOrigin = "https://supabase-tls.localhost:8443";

/** Pins local Auth transport to IPv4 loopback while verifying the canonical TLS hostname and trusted CA. */
export function fetchLocalAuth(input, init = {}, connect = httpsRequest) {
    const url = new URL(input);
    if (url.origin !== authOrigin) throw new Error("Browser session authentication is restricted to local Auth");
    return new Promise((resolve, reject) => {
        const request = connect({
            hostname: "127.0.0.1", port: 8443, servername: url.hostname,
            path: `${url.pathname}${url.search}`, method: init.method,
            headers: { ...Object.fromEntries(new Headers(init.headers)), host: url.host },
            rejectUnauthorized: true,
        }, response => {
            const chunks = [];
            response.on("data", chunk => chunks.push(chunk));
            response.on("error", reject);
            response.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
        });
        request.on("error", reject);
        request.setTimeout(30_000, () => request.destroy(new Error("Local Auth request timed out")));
        request.end(init.body);
    });
}

/** Obtains a genuine local password session and installs Supabase's SSR-encoded cookies in memory only. */
export async function seedBrowserSession(context, publishableKey, request = fetchLocalAuth) {
    if (!publishableKey) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required for local browser authentication");
    const cookies = new Map();
    const supabase = createServerClient(authOrigin, publishableKey, {
        global: { fetch: request },
        cookieOptions: { secure: true, sameSite: "lax", path: "/" },
        cookies: {
            getAll: () => [...cookies.values()],
            setAll: values => { for (const cookie of values) cookies.set(cookie.name, cookie); },
        },
    });
    const { data, error } = await supabase.auth.signInWithPassword({ email: fixture.email, password: fixture.password });
    if (error || !data.session) throw new Error("Local password authentication failed");
    if (data.user?.id !== fixture.accountId || !Array.isArray(data.user.identities) || data.user.identities.some(identity => identity.provider === "discord")) {
        throw new Error("Local authentication did not return the expected Discord-free account");
    }
    // Only map transport attributes; cookie names, values and chunking are owned by @supabase/ssr.
    await context.addCookies([...cookies.values()].map(({ name, value, options }) => ({
        name, value, domain: "supabase-tls.localhost", path: options.path,
        secure: options.secure, httpOnly: options.httpOnly, sameSite: "Lax",
    })));
    return { accountId: data.user.id };
}
