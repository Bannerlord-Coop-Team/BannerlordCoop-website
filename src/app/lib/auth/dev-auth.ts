import { isLoopbackHostname } from "@/app/lib/control-plane/loopback-origin";

// Returns the configured local debug sign-in email, or null unless running `next dev` on a loopback host.
export function getDevAuthEmail(env: { NODE_ENV?: string; DEV_AUTH_EMAIL?: string }, hostname: string): string | null {
    if (env.NODE_ENV !== "development") return null;
    if (!isLoopbackHostname(hostname)) return null;
    const email = env.DEV_AUTH_EMAIL?.trim();
    return email ? email : null;
}
