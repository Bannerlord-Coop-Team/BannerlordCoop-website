import "server-only";
import { cookies } from "next/headers";
import { localeDefinitions, resolveLocale } from "./registry";
import { createTranslator } from "./translator";
import { localeCookie, type Locale, type Messages, type Namespace, type Translator } from "./types";

/** Resolves the explicit cookie only; browser language and geography never select a locale. */
export async function getLocale(): Promise<Locale> {
    return resolveLocale((await cookies()).get(localeCookie)?.value);
}

/** Loads only requested namespaces, rejecting incomplete or disabled locale definitions. */
export async function getMessages(namespaces: readonly Namespace[], locale?: Locale): Promise<Messages> {
    const selected = locale ?? await getLocale();
    const definition = localeDefinitions[selected];
    if (!definition?.enabled) throw new Error(`Locale is not enabled: ${selected}`);
    const entries = await Promise.all(namespaces.map(async (namespace) => {
        const load = definition.dictionaries[namespace];
        if (!load) throw new Error(`Missing namespace: ${selected}.${namespace}`);
        return [namespace, (await load()).default] as const;
    }));
    return Object.fromEntries(entries);
}

/** Creates a server translator for one namespace using the same locale as page delivery. */
export async function getTranslations(namespace: Namespace, locale?: Locale): Promise<Translator> {
    const selected = locale ?? await getLocale();
    const messages = await getMessages([namespace], selected);
    return createTranslator(selected, messages[namespace]!);
}

/** Provides the activated locale's Open Graph identifier to server metadata. */
export async function getOpenGraphLocale(): Promise<string> {
    return localeDefinitions[await getLocale()].openGraphLocale;
}
