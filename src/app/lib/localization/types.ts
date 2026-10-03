import type { ReactNode } from "react";

export const locales = ["en", "zh-CN", "ru", "es", "pt-BR", "pt-PT", "ja", "ko", "de", "tr", "fr"] as const;
export type Locale = (typeof locales)[number];
export const namespaces = ["common", "home", "account", "changelog", "cheats", "login", "servers", "managed-server", "server-common", "live-server", "server-wireframe", "support", "not-found"] as const;
export type Namespace = (typeof namespaces)[number];
export type PluralMessage = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Dictionary = Record<string, string | PluralMessage>;
export type Messages = Partial<Record<Namespace, Dictionary>>;
export type TranslationParams = Record<string, string | number>;
export type RichSlots = Record<string, ReactNode>;
export type LocaleOption = { locale: Locale; name: string };
export type LocaleDefinition = LocaleOption & {
    enabled: boolean;
    openGraphLocale: string;
    dictionaries: Partial<Record<Namespace, () => Promise<{ default: Dictionary }>>>;
};
export type Translator = {
    locale: Locale;
    t: (key: string, params?: TranslationParams) => string;
    rich: (key: string, slots: RichSlots) => ReactNode;
    number: (value: number, options?: Intl.NumberFormatOptions) => string;
    date: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
};

export const localeCookie = "blcoop-locale";
export const localeCookieOptions = { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 } as const;
