"use client";

import type {
    HostedServerLog,
    HostedServerStatus,
    RestartSchedule,
} from "@/app/lib/hosting/servers";
import { CircleStop, Clock3, Play, RotateCw, Terminal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type RuntimeStatus = HostedServerStatus | "Starting" | "Stopping" | "Restarting";
type ControlAction = "start" | "stop" | "restart";

const statusStyles: Record<RuntimeStatus, string> = {
    Online: "bg-emerald-400",
    Offline: "bg-foreground-dim",
    Starting: "bg-gold animate-pulse",
    Stopping: "bg-gold animate-pulse",
    Restarting: "bg-gold animate-pulse",
};

function currentTime() {
    return new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    }).format(new Date());
}

export function ServerControlPanel({
    initialLogs,
    initialStatus,
    restartSchedule,
    serverName,
}: {
    initialLogs: HostedServerLog[];
    initialStatus: HostedServerStatus;
    restartSchedule: RestartSchedule;
    serverName: string;
}) {
    const [status, setStatus] = useState<RuntimeStatus>(initialStatus);
    const [logs, setLogs] = useState(initialLogs);
    const [cronRestartEnabled, setCronRestartEnabled] = useState(
        restartSchedule.enabled,
    );
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
    const logViewport = useRef<HTMLDivElement>(null);
    const isTransitioning = !["Online", "Offline"].includes(status);

    const addLog = useCallback((message: string, level: HostedServerLog["level"] = "INFO") => {
        setLogs((current) => [
            ...current.slice(-79),
            { time: currentTime(), level, message },
        ]);
    }, []);

    useEffect(() => {
        const viewport = logViewport.current;
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
    }, [logs]);

    useEffect(() => {
        if (status !== "Online") return;
        const interval = setInterval(() => {
            addLog("Demo health check passed — placeholder node is responsive");
        }, 8000);
        return () => clearInterval(interval);
    }, [addLog, status]);

    useEffect(() => {
        const pendingTimers = timers.current;
        return () => pendingTimers.forEach(clearTimeout);
    }, []);

    function completeAfter(delay: number, callback: () => void) {
        const timer = setTimeout(callback, delay);
        timers.current.push(timer);
    }

    function toggleCronRestart() {
        const nextEnabled = !cronRestartEnabled;
        setCronRestartEnabled(nextEnabled);
        addLog(
            `Scheduled restart ${nextEnabled ? "enabled" : "disabled"} for ${restartSchedule.description} (simulation)`,
            nextEnabled ? "INFO" : "WARN",
        );
    }

    function runAction(action: ControlAction) {
        if (isTransitioning) return;

        if (action === "start" && status === "Offline") {
            setStatus("Starting");
            addLog(`Start requested for ${serverName} (simulation)`);
            completeAfter(900, () => {
                setStatus("Online");
                addLog("Server started successfully in demo mode");
            });
        }

        if (action === "stop" && status === "Online") {
            setStatus("Stopping");
            addLog(`Graceful stop requested for ${serverName} (simulation)`, "WARN");
            completeAfter(900, () => {
                setStatus("Offline");
                addLog("Server stopped; campaign state preserved in demo mode", "WARN");
            });
        }

        if (action === "restart" && status === "Online") {
            setStatus("Restarting");
            addLog(`Restart requested for ${serverName} (simulation)`, "WARN");
            completeAfter(650, () => addLog("Stopping game process…"));
            completeAfter(1400, () => {
                setStatus("Online");
                addLog("Restart completed successfully in demo mode");
            });
        }
    }

    return (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.72fr)_minmax(32rem,1.28fr)]">
            <section className="rounded-sm border border-white/10 bg-surface p-5 sm:p-6" aria-labelledby="server-controls-heading">
                <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-5">
                    <div>
                        <p className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-foreground-muted">
                            Runtime state
                        </p>
                        <div className="mt-2 flex items-center gap-2.5">
                            <span aria-hidden="true" className={`size-2 rounded-full ${statusStyles[status]}`} />
                            <p className="font-display text-2xl font-semibold text-foreground" aria-live="polite">
                                {status}
                            </p>
                        </div>
                    </div>
                    <span className="rounded-sm border border-gold/20 bg-gold/[0.06] px-2.5 py-1 font-label text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-gold">
                        Simulated
                    </span>
                </div>

                <h2 id="server-controls-heading" className="mt-5 font-label text-xs font-semibold uppercase tracking-[0.18em] text-foreground-muted">
                    Server controls
                </h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                    <button
                        type="button"
                        onClick={() => runAction("start")}
                        disabled={status !== "Offline" || isTransitioning}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-4 font-label text-xs font-semibold uppercase tracking-[0.12em] text-emerald-300 transition-colors hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                        <Play aria-hidden="true" className="size-4" /> Start
                    </button>
                    <button
                        type="button"
                        onClick={() => runAction("stop")}
                        disabled={status !== "Online" || isTransitioning}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-crimson/60 bg-crimson/15 px-4 font-label text-xs font-semibold uppercase tracking-[0.12em] text-red-200 transition-colors hover:bg-crimson/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson disabled:cursor-not-allowed disabled:opacity-35"
                    >
                        <CircleStop aria-hidden="true" className="size-4" /> Stop
                    </button>
                    <button
                        type="button"
                        onClick={() => runAction("restart")}
                        disabled={status !== "Online" || isTransitioning}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-gold/40 bg-gold/10 px-4 font-label text-xs font-semibold uppercase tracking-[0.12em] text-gold transition-colors hover:bg-gold/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:cursor-not-allowed disabled:opacity-35"
                    >
                        <RotateCw aria-hidden="true" className="size-4" /> Restart
                    </button>
                </div>
                <div className="mt-5 border-t border-white/10 pt-5">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 gap-3">
                            <Clock3 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gold" />
                            <div>
                                <h3 className="font-label text-xs font-semibold uppercase tracking-[0.16em] text-foreground">
                                    Cron restart
                                </h3>
                                <p className="mt-1 text-xs leading-5 text-foreground-muted">
                                    {restartSchedule.description}
                                </p>
                                <p className="mt-1 font-mono text-[0.68rem] text-foreground-dim">
                                    {restartSchedule.cron} · {restartSchedule.timezone}
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={cronRestartEnabled}
                            aria-label="Toggle scheduled cron restart"
                            onClick={toggleCronRestart}
                            className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
                                cronRestartEnabled
                                    ? "border-gold bg-gold/80"
                                    : "border-white/20 bg-background"
                            }`}
                        >
                            <span
                                aria-hidden="true"
                                className={`absolute top-0.5 left-0 size-4 rounded-full bg-foreground shadow-sm transition-transform ${
                                    cronRestartEnabled ? "translate-x-6" : "translate-x-0.5"
                                }`}
                            />
                        </button>
                    </div>
                    <p className={`mt-3 font-label text-[0.62rem] font-semibold uppercase tracking-[0.14em] ${cronRestartEnabled ? "text-emerald-300" : "text-foreground-dim"}`} aria-live="polite">
                        Scheduled restart {cronRestartEnabled ? "enabled" : "disabled"}
                    </p>
                </div>

                <p className="mt-5 text-xs leading-5 text-foreground-dim">
                    Controls and schedule settings only update this browser preview. They do not contact a VPS and reset when the page reloads.
                </p>
            </section>

            <section className="overflow-hidden rounded-sm border border-white/10 bg-[#050605]" aria-labelledby="live-log-heading">
                <div className="flex min-h-14 items-center justify-between gap-4 border-b border-white/10 bg-surface px-4 sm:px-5">
                    <div className="flex items-center gap-2.5">
                        <Terminal aria-hidden="true" className="size-4 text-gold" />
                        <h2 id="live-log-heading" className="font-label text-xs font-semibold uppercase tracking-[0.16em] text-foreground">
                            Live server log
                        </h2>
                    </div>
                    <span className="inline-flex items-center gap-2 font-label text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-foreground-muted">
                        <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Demo stream
                    </span>
                </div>
                <div
                    ref={logViewport}
                    role="log"
                    aria-live="polite"
                    aria-label="Simulated server log output"
                    className="h-72 overflow-y-auto px-4 py-4 font-mono text-xs leading-6 sm:px-5"
                >
                    {logs.map((log, index) => (
                        <div key={`${log.time}-${index}`} className="grid grid-cols-[4.5rem_3.25rem_minmax(0,1fr)] gap-2">
                            <span className="text-foreground-dim">{log.time}</span>
                            <span className={log.level === "WARN" ? "text-gold" : "text-emerald-400"}>
                                {log.level}
                            </span>
                            <span className="break-words text-foreground-muted">{log.message}</span>
                        </div>
                    ))}
                    <span className="mt-1 inline-block h-4 w-1.5 animate-pulse bg-gold/80" aria-hidden="true" />
                </div>
            </section>
        </div>
    );
}
