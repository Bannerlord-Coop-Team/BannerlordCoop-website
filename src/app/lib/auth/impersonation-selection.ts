import "server-only";
import { cookies } from "next/headers";
import { IMPERSONATION_COOKIE } from "./impersonation-cookie-options";

/** Returns the request's raw impersonation selection cookie value, or null when none is present; never validates it. */
export async function getImpersonationSelection(): Promise<string | null> {
    const cookie = (await cookies()).get(IMPERSONATION_COOKIE);
    if (!cookie) return null;
    return cookie.value;
}

/** Reports whether the request carries an impersonation selection, without validating or resolving it. */
export async function hasImpersonationSelection() {
    return (await getImpersonationSelection()) !== null;
}
