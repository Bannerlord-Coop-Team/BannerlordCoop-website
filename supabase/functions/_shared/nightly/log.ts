// The gateway's structured log: one event object per line, carrying codes and identifiers, never secrets.

/** Receives one structured log event. */
export type GatewayLog = (event: Record<string, unknown>) => void;

/** The default log sink: one JSON line on stderr. */
export function logToStderr(event: Record<string, unknown>): void {
    console.error(JSON.stringify(event));
}
