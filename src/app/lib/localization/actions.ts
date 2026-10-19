"use server";

import { cookies } from "next/headers";
import { resolveLocale } from "./registry";
import { localeCookie, localeCookieOptions, type Locale } from "./types";

/** Persists only an explicitly enabled locale; untrusted action inputs cannot activate a language. */
export async function setLocale(value: string): Promise<Locale> {
    const locale = resolveLocale(value);
    (await cookies()).set(localeCookie, locale, localeCookieOptions);
    return locale;
}
