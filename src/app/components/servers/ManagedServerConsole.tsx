"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MAXIMUM_TEXT_CHARACTERS = 128 * 1_024;
const MAXIMUM_LINES = 2_000;
const MAXIMUM_SSE_FRAME_BYTES = 16 * 1_024;

type ConsoleState = "disconnected" | "connecting" | "connected" | "expired" | "truncated" | "unavailable";

/** Streams bounded current-run output inside the managed game console card. */
export function ManagedServerConsole({ serverId }: { serverId: string }) {
    const [state, setState] = useState<ConsoleState>("disconnected");
    const [text, setText] = useState("");
    const active = useRef<AbortController | null>(null);

    /** Cancels the active stream and returns the toggle to its disconnected state. */
    const disconnect = () => {
        active.current?.abort();
        active.current = null;
        setState("disconnected");
    };

    /** Opens the current-run output stream and reflects its progress in the toggle. */
    const connect = useCallback(async () => {
        if (active.current !== null) return;
        const controller = new AbortController();
        active.current = controller;
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
        } finally {
            if (active.current === controller) active.current = null;
        }
    }, [serverId]);

    // Connect on mount or a server change, and release the stream on cleanup.
    useEffect(() => {
        // Starting the external stream also synchronizes its visible connection state.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void connect();
        return () => {
            active.current?.abort();
            active.current = null;
        };
    }, [connect]);

    return (
        <div className="p-5">
            <p className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-gold">Live output</p>
            <p className="mt-2 text-sm leading-6 text-foreground-muted">Read-only current-run output. Nothing is saved, and sessions expire after five minutes.</p>
            <button
                type="button"
                onClick={() => active.current ? disconnect() : void connect()}
                title={state === "connecting" || state === "connected" ? "Disconnect from live output" : "Connect to live output"}
                aria-live="polite"
                className="mt-4 rounded-sm bg-gold px-4 py-2 font-label text-xs font-semibold uppercase tracking-[0.12em] text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >{state}</button>
            <pre aria-label="Live game console output" className="mt-4 h-72 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-white/10 bg-black/50 p-3 font-mono text-xs text-foreground">{text || "No live output."}</pre>
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
