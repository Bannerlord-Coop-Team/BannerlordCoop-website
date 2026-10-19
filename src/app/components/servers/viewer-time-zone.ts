import { useSyncExternalStore } from "react";

// Times carry a zone label because they render in UTC on the server and the viewer's zone after hydration.
export const ZONED_DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" };

const subscribeToTimeZone = () => () => undefined;
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** UTC while rendering on the server and hydrating, then the viewer's own time zone. */
export function useViewerTimeZone() {
    return useSyncExternalStore(subscribeToTimeZone, browserTimeZone, () => "UTC");
}
