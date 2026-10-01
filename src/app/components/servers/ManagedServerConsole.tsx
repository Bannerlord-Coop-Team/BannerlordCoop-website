"use client";

import { useEffect, useState } from "react";

const MAXIMUM_TEXT_CHARACTERS = 128 * 1_024;
const MAXIMUM_LINES = 2_000;
const MAXIMUM_SSE_FRAME_BYTES = 16 * 1_024;

type ConsoleState = "disconnected" | "connecting" | "connected" | "expired" | "truncated" | "unavailable";

const consoleStateMessages: Record<ConsoleState, string> = {
    connecting: "Connecting to live output…",
    connected: "No live output.",
    disconnected: "Console disconnected. Reload the page to reconnect.",
    expired: "Console session expired. Reload the page to reconnect.",
    truncated: "Console output was truncated. Reload the page to reconnect.",
    unavailable: "Console output is unavailable. Reload the page to try again.",
};

/** Streams bounded current-run output inside the managed game console card. */
export function ManagedServerConsole({ serverId }: { serverId: string }) {
    const [state, setState] = useState<ConsoleState>("connecting");
    const [text, setText] = useState("");
    useEffect(() => {
        const controller = new AbortController();

        /** Streams current-run output until the server closes it or the component unmounts. */
        async function connect() {
            setText("");
            setState("connecting");
            try {
                const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/console`, {
                    headers: { accept: "text/event-stream" },
                    cache: "no-store",
                    signal: controller.signal,
                });
                if (controller.signal.aborted) return;
                if (!response.ok || response.body === null) throw new Error("unavailable");
                setState("connected");
                const reader = response.body.getReader();
                const decoder = new TextDecoder("utf-8", { fatal: true });
                let pending = "";
                for (;;) {
                    const next = await reader.read();
                    if (controller.signal.aborted) return;
                    const decoded = decodeConsoleStreamChunk(pending, next.done ? undefined : next.value, decoder, next.done);
                    pending = decoded.pending;
                    for (const event of decoded.events) {
                        if (event.type === "line") {
                            setText((current) => boundedConsoleText(current, event.text));
                        } else if (event.type === "truncated") {
                            setState("truncated");
                        } else if (event.type === "expired") {
                            setState("expired");
                        } else if (event.type === "ended") {
                            setState("disconnected");
                        }
                    }
                    if (next.done) break;
                }
                if (!controller.signal.aborted) setState((current) => current === "expired" || current === "truncated" ? current : "disconnected");
            } catch {
                if (!controller.signal.aborted) setState("unavailable");
            }
        }

        void connect();
        return () => controller.abort();
    }, [serverId]);

    return (
        <div>
            <p id="console-stream-help" className="sr-only">Current-run output connects automatically. Nothing is saved, and sessions expire after five minutes.</p>
            <pre aria-label="Live game console output" aria-describedby="console-stream-help" tabIndex={0} className="h-64 overflow-auto whitespace-pre-wrap break-words bg-background p-4 font-mono text-[13px] leading-6 text-foreground outline-gold sm:h-[min(44vh,28rem)] sm:min-h-64">{text || consoleStateMessages[state]}{text && state !== "connected" ? `\n${consoleStateMessages[state]}` : ""}</pre>
        </div>
    );
}

export function boundedConsoleText(current: string, line: string): string {
    const combined = `${current}${line}\n`;
    const lines = combined.split("\n");
    const lineBounded = lines.length > MAXIMUM_LINES ? lines.slice(lines.length - MAXIMUM_LINES).join("\n") : combined;
    return lineBounded.length > MAXIMUM_TEXT_CHARACTERS
        ? lineBounded.slice(lineBounded.length - MAXIMUM_TEXT_CHARACTERS)
        : lineBounded;
}

export function decodeConsoleStreamChunk(
    previous: string,
    chunk: Uint8Array | undefined,
    decoder: TextDecoder,
    final = false,
): { pending: string; events: ReturnType<typeof parseConsoleEvent>[] } {
    let pending = previous + decoder.decode(chunk, { stream: !final });
    const events: ReturnType<typeof parseConsoleEvent>[] = [];
    for (;;) {
        const boundary = pending.indexOf("\n\n");
        if (boundary < 0) break;
        if (new TextEncoder().encode(pending.slice(0, boundary)).byteLength > MAXIMUM_SSE_FRAME_BYTES) throw new Error("Console event exceeded limit");
        events.push(parseConsoleEvent(pending.slice(0, boundary)));
        pending = pending.slice(boundary + 2);
    }
    if (new TextEncoder().encode(pending).byteLength > MAXIMUM_SSE_FRAME_BYTES || (final && pending.length > 0)) {
        throw new Error("Console event exceeded limit");
    }
    return { pending, events };
}

export function parseConsoleEvent(frame: string): { type: "line"; text: string } | { type: "truncated" | "expired" | "ended" | "ignored" } {
    let type = "message";
    let data = "";
    for (const line of frame.split("\n")) {
        if (line.startsWith("event: ")) type = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
    }
    if (type === "line") {
        try {
            const value: unknown = JSON.parse(data);
            if (typeof value === "string" && value.length <= 16_384) return { type: "line", text: value };
        } catch { /* Ignore malformed upstream data. */ }
        return { type: "ignored" };
    }
    return type === "truncated" || type === "expired" || type === "ended" ? { type } : { type: "ignored" };
}
