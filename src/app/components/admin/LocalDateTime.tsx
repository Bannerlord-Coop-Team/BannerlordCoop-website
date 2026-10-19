"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function LocalDateTime({ value, empty = "Never" }: { value: string | null; empty?: string }) {
    const isClient = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
    if (value === null) return <>{empty}</>;
    if (!isClient) return <time dateTime={value}>Localizing…</time>;
    return <time dateTime={value} title={`${value} (UTC)`}>{formatLocalDateTime(value)}</time>;
}

/** A time of day with seconds in the viewer's zone, for steps that all happen within minutes of each other. */
export function LocalTime({ value, empty = "—" }: { value: string | null; empty?: string }) {
    const isClient = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
    if (value === null) return <>{empty}</>;
    if (!isClient) return <time dateTime={value}>Localizing…</time>;
    return <time dateTime={value} title={`${formatLocalDateTime(value)} (${value} UTC)`}>{formatLocalTime(value)}</time>;
}

export function formatLocalTime(value: string, options: { locale?: string; timeZone?: string } = {}) {
    const date = new Date(value);
    if (!Number.isFinite(date.valueOf())) return "Invalid time";
    return new Intl.DateTimeFormat(options.locale, {
        timeStyle: "medium",
        ...(options.timeZone ? { timeZone: options.timeZone } : {}),
    }).format(date);
}

export function formatLocalDateTime(
    value: string,
    options: { locale?: string; timeZone?: string } = {},
) {
    const date = new Date(value);
    if (!Number.isFinite(date.valueOf())) return "Invalid date";
    return new Intl.DateTimeFormat(options.locale, {
        dateStyle: "medium",
        timeStyle: "short",
        ...(options.timeZone ? { timeZone: options.timeZone } : {}),
    }).format(date);
}
