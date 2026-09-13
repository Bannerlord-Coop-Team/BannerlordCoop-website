"use client";

import { useEffect, useRef, useState } from "react";

const MAXIMUM_TEXT_CHARACTERS = 128 * 1_024;
const MAXIMUM_LINES = 2_000;

type ConsoleState = "disconnected" | "connecting" | "connected" | "expired" | "truncated" | "unavailable";

export function ManagedServerConsole({ serverId }: { serverId: string }) {
    const [state, setState] = useState<ConsoleState>("disconnected");
    const [text, setText] = useState("");
    const active = useRef<AbortController | null>(null);

    const disconnect = () => {
        active.current?.abort();
        active.current = null;
        setState("disconnected");
    };
    useEffect(() => () => active.current?.abort(), []);

    const connect = async () => {
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
            if (!response.ok || response.body === null) throw new Error("unavailable");
            setState("connected");
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let pending = "";
            for (;;) {
                const next = await reader.read();
                if (next.done) break;
                pending += decoder.decode(next.value, { stream: true });
                for (;;) {
                    const boundary = pending.indexOf("\n\n");
                    if (boundary < 0) break;
                    const event = parseConsoleEvent(pending.slice(0, boundary));
                    pending = pending.slice(boundary + 2);
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
            }
            if (!controller.signal.aborted) setState((current) => current === "expired" || current === "truncated" ? current : "disconnected");
        } catch {
            if (!controller.signal.aborted) setState("unavailable");
        } finally {
            if (active.current === controller) active.current = null;
        }
    };

    return (
        <section className="mt-6 rounded-sm border border-white/10 bg-surface p-5 sm:p-6" aria-labelledby="managed-console-heading">
            <p className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-gold">Live output</p>
            <h2 id="managed-console-heading" className="mt-2 font-display text-2xl font-semibold text-foreground sm:text-3xl">Game console</h2>
            <p className="mt-2 text-sm leading-6 text-foreground-muted">Read-only current-run output. Nothing is saved, and sessions expire after five minutes.</p>
            <div className="mt-4 flex items-center gap-3">
                <button type="button" onClick={() => void connect()} disabled={active.current !== null} className="rounded-sm bg-gold px-4 py-2 font-label text-xs font-semibold uppercase tracking-[0.12em] text-black disabled:opacity-50">Connect</button>
                <button type="button" onClick={disconnect} disabled={active.current === null} className="rounded-sm border border-white/15 px-4 py-2 font-label text-xs font-semibold uppercase tracking-[0.12em] text-foreground disabled:opacity-50">Disconnect</button>
                <span role="status" className="text-xs text-foreground-muted">{state}</span>
            </div>
            <pre aria-label="Live game console output" className="mt-4 h-72 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-white/10 bg-black/50 p-3 font-mono text-xs text-foreground">{text || "No live output."}</pre>
        </section>
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
