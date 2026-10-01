"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { readManagedServerConfig, saveManagedServerConfig } from "@/app/servers/managed-server-config-actions";
import { fileButtonClass, filePrimaryButtonClass } from "./server-file-styles";
import {
    MANAGED_DIFFICULTY_LEVELS, MANAGED_GOLD_FOOD_CHANGE_MODES, MANAGED_LORD_DEFECTION_RETRY_MODES,
    parseManagedServerConfiguration, type ManagedServerConfiguration,
} from "../../../../supabase/functions/_shared/managed-server-configuration";
import type { RunnerConfigurationFile, RunnerConfigurationPart } from "../../../../supabase/functions/_shared/server-configuration-contract";

export type ConfigAccess = { serverId: string; userId: string; canEdit: boolean };
type Settings = { serverConfig: ManagedServerConfiguration["serverConfig"]; modConfig: ManagedServerConfiguration["modConfig"] };
type Live = { server: RunnerConfigurationFile | null; mod: RunnerConfigurationFile | null };
type Group = "serverConfig" | "difficulty" | "modOptions";
type Field = { key: string; label: string; help?: string } & (
    | { kind: "boolean" }
    | { kind: "integer"; min: number; max: number }
    | { kind: "number"; min: number; max: number; step: number }
    | { kind: "choice"; options: readonly string[] });

const SERVER_FIELDS: Field[] = [
    { key: "autosaveMinutes", label: "Autosave interval (minutes)", kind: "integer", min: 0, max: 1440, help: "0 turns autosave off." },
    { key: "logFile", label: "Write a server log file", kind: "boolean" },
    { key: "steam", label: "Steam integration", kind: "boolean" },
    { key: "traceTick", label: "Trace ticks (diagnostics)", kind: "boolean" },
    { key: "tracePublish", label: "Trace publishing (diagnostics)", kind: "boolean" },
    { key: "traceBandits", label: "Trace bandits (diagnostics)", kind: "boolean" },
];
const DIFFICULTY_FIELDS: Field[] = [
    { key: "playerReceivedDamage", label: "Damage to player", kind: "choice", options: MANAGED_DIFFICULTY_LEVELS },
    { key: "playerTroopsReceivedDamage", label: "Damage to player troops", kind: "choice", options: MANAGED_DIFFICULTY_LEVELS },
    { key: "combatAIDifficulty", label: "Combat AI difficulty", kind: "choice", options: MANAGED_DIFFICULTY_LEVELS },
    { key: "recruitmentDifficulty", label: "Recruitment difficulty", kind: "choice", options: MANAGED_DIFFICULTY_LEVELS },
    { key: "playerMapMovementSpeed", label: "Player map movement speed", kind: "choice", options: MANAGED_DIFFICULTY_LEVELS },
    { key: "stealthAndDisguiseDifficulty", label: "Stealth and disguise difficulty", kind: "choice", options: MANAGED_DIFFICULTY_LEVELS },
    { key: "persuasionSuccessChance", label: "Persuasion success chance", kind: "choice", options: MANAGED_DIFFICULTY_LEVELS },
    { key: "clanMemberDeathChance", label: "Clan member death chance", kind: "choice", options: MANAGED_DIFFICULTY_LEVELS },
    { key: "battleDeath", label: "Death in battle", kind: "choice", options: MANAGED_DIFFICULTY_LEVELS },
    { key: "birthAndDeath", label: "Birth and death", kind: "boolean" },
    { key: "autoAllocateClanMemberPerks", label: "Automatically allocate clan member perks", kind: "boolean" },
];
const MOD_OPTION_FIELDS: Field[] = [
    { key: "fastForwardEnabled", label: "Allow fast forward", kind: "boolean" },
    { key: "autoPauseEnabled", label: "Auto-pause", kind: "boolean" },
    { key: "clientsCanUseCheats", label: "Clients can use cheats", kind: "boolean" },
    { key: "goldFoodInfluenceChangeInSettlements", label: "Gold, food and influence change in settlements", kind: "boolean" },
    { key: "goldFoodInfluenceChangeInBattles", label: "Gold, food and influence change in battles", kind: "choice", options: MANAGED_GOLD_FOOD_CHANGE_MODES },
    { key: "goldFoodInfluenceChangeForDisconnectedPlayers", label: "Gold, food and influence change for disconnected players", kind: "boolean" },
    { key: "playerBattleAiJoinWindowHours", label: "Hours AI may join player battles", kind: "integer", min: 0, max: 8760 },
    { key: "speedLimitWhilePlayersInBattle", label: "Limit map speed while players are in battle", kind: "boolean" },
    { key: "wandererLimit", label: "Wanderer limit", kind: "integer", min: 0, max: 1000 },
    { key: "wandererLimitScalesWithPlayers", label: "Wanderer limit scales with players", kind: "boolean" },
    { key: "playerKingdomClanTierRequired", label: "Clan tier required to create a kingdom", kind: "integer", min: 0, max: 6 },
    { key: "smithingStaminaRecoveryOutsideSettlements", label: "Smithing stamina recovers outside settlements", kind: "boolean" },
    { key: "smithingStaminaRecoveryMultiplier", label: "Smithing stamina recovery multiplier", kind: "number", min: 0, max: 100, step: 0.01 },
    { key: "maximumLootersMultiplier", label: "Maximum looters multiplier", kind: "number", min: 0, max: 100, step: 0.1 },
    { key: "looterPartySizeMultiplier", label: "Looter party size multiplier", kind: "number", min: 0, max: 100, step: 0.1 },
    { key: "lordDefectionRetries", label: "Lord defection retries", kind: "choice", options: MANAGED_LORD_DEFECTION_RETRY_MODES },
    { key: "enableHeroExecutions", label: "Allow hero executions", kind: "boolean" },
    { key: "enablePlayerClanMemberExecutions", label: "Allow executing player clan members", kind: "boolean" },
];
const GROUPS: { group: Group; title: string; description: string; fields: Field[] }[] = [
    { group: "serverConfig", title: "Server settings", description: "Saved to server-config.json. Passwords, ports and campaign selection are managed separately.", fields: SERVER_FIELDS },
    { group: "difficulty", title: "Difficulty", description: "Saved to mod-config.json.", fields: DIFFICULTY_FIELDS },
    { group: "modOptions", title: "Gameplay options", description: "Saved to mod-config.json.", fields: MOD_OPTION_FIELDS },
];
const inputClass = "mt-2 block w-full min-w-0 rounded-md border border-white/15 bg-background px-3 py-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-red-400";

function humanize(value: string) {
    return value.replace(/([a-z])([A-Z])/gu, "$1 $2").replace(/^./u, (letter) => letter.toUpperCase()).replace(/ [A-Z](?=[a-z])/gu, (word) => word.toLowerCase());
}
function groupValues(settings: Settings, group: Group): Record<string, unknown> {
    return (group === "serverConfig" ? settings.serverConfig : settings.modConfig[group]) as unknown as Record<string, unknown>;
}
function withValue(settings: Settings, group: Group, key: string, value: unknown): Settings {
    if (group === "serverConfig") return { ...settings, serverConfig: { ...settings.serverConfig, [key]: value } };
    return { ...settings, modConfig: { ...settings.modConfig, [group]: { ...settings.modConfig[group], [key]: value } } };
}
function numberProblem(field: Field, value: unknown): string | null {
    if (field.kind !== "integer" && field.kind !== "number") return null;
    if (typeof value !== "number" || Number.isNaN(value)) return "Enter a number.";
    if (field.kind === "integer" && !Number.isInteger(value)) return "Enter a whole number.";
    if (value < field.min || value > field.max) return `Enter a value from ${field.min} to ${field.max}.`;
    return null;
}
function pretty(settings: Settings) { return JSON.stringify({ serverConfig: settings.serverConfig, modConfig: settings.modConfig }, null, 2); }
function parseSettings(value: unknown): Settings {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected an object with serverConfig and modConfig.");
    const keys = Object.keys(value);
    if (keys.length !== 2 || !("serverConfig" in value) || !("modConfig" in value)) throw new Error("Expected exactly serverConfig and modConfig.");
    const parsed = parseManagedServerConfiguration({ schemaVersion: 1, ...(value as object) });
    return { serverConfig: parsed.serverConfig, modConfig: parsed.modConfig };
}
function sameSettings(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }

export function ManagedServerConfigEditor({ configuration, access, notice }: { configuration?: ManagedServerConfiguration; access?: ConfigAccess; notice?: ReactNode }) {
    return <ConfigSession key={access ? `${access.userId}:${access.serverId}` : "preview"} configuration={configuration} access={access} notice={notice} />;
}

function ConfigSession({ configuration, access, notice }: { configuration?: ManagedServerConfiguration; access?: ConfigAccess; notice?: ReactNode }) {
    const stored: Settings | null = configuration ? { serverConfig: configuration.serverConfig, modConfig: configuration.modConfig } : null;
    const [mode, setMode] = useState<"form" | "json">("form");
    const [live, setLive] = useState<Live>({ server: null, mod: null });
    const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "failed">(access ? "loading" : "idle");
    const [loadMessage, setLoadMessage] = useState("");
    const [loadVersion, setLoadVersion] = useState(0);
    const [draft, setDraft] = useState<Settings | null>(stored);
    const [jsonText, setJsonText] = useState(stored ? pretty(stored) : "");
    const [jsonError, setJsonError] = useState("");
    const [message, setMessage] = useState("");
    const [stale, setStale] = useState(false);
    const [pending, startTransition] = useTransition();
    const requests = useRef<Record<RunnerConfigurationPart, { requestId: string; body: string } | null>>({ server: null, mod: null });

    const serverId = access?.serverId;
    const userId = access?.userId;
    useEffect(() => {
        if (!serverId || !userId) return;
        let cancelled = false;
        void (async () => {
            const read = async (part: RunnerConfigurationPart) => {
                try { return await readManagedServerConfig(serverId, part, userId); } catch { return null; }
            };
            const [server, mod] = await Promise.all([read("server"), read("mod")]);
            if (cancelled) return;
            if (server?.ok && mod?.ok && server.file.configPart === "server" && mod.file.configPart === "mod") {
                const settings: Settings = { serverConfig: server.file.settings, modConfig: mod.file.settings };
                setLive({ server: server.file, mod: mod.file });
                setDraft(settings); setJsonText(pretty(settings)); setJsonError(""); setStale(false);
                setLoadState("ready");
            } else {
                setLoadMessage((server && !server.ok ? server.message : mod && !mod.ok ? mod.message : null) ?? "The live configuration could not be loaded. Try again.");
                setLoadState("failed");
            }
        })();
        return () => { cancelled = true; };
    }, [serverId, userId, loadVersion]);

    const baseline: Settings | null = loadState === "ready" && live.server && live.mod
        ? { serverConfig: live.server.settings as Settings["serverConfig"], modConfig: live.mod.settings as Settings["modConfig"] } : stored;
    const editable = access?.canEdit === true && loadState === "ready" && !pending;
    const dirtyParts = draft && baseline ? ([
        ...(sameSettings(draft.serverConfig, baseline.serverConfig) ? [] : ["server settings"]),
        ...(sameSettings(draft.modConfig, baseline.modConfig) ? [] : ["gameplay settings"]),
    ]) : [];
    const dirty = dirtyParts.length > 0;
    const problems = draft ? GROUPS.flatMap(({ group, fields }) => fields.filter((field) => numberProblem(field, groupValues(draft, group)[field.key]) !== null)) : [];

    function reload() {
        if (!access) return;
        setLoadState("loading"); setMessage(""); setStale(false); setLoadVersion((value) => value + 1);
    }
    function switchMode(next: "form" | "json") {
        if (next === mode || !draft) return;
        if (next === "json") setJsonText(pretty(draft));
        else if (jsonError) { setMessage("Fix the JSON before switching to the form."); return; }
        setMode(next);
    }
    function editJson(text: string) {
        setJsonText(text); setMessage("");
        try { setDraft(parseSettings(JSON.parse(text))); setJsonError(""); }
        catch (error) { setJsonError(error instanceof SyntaxError ? "This is not valid JSON." : error instanceof Error ? error.message : "Unsupported settings."); }
    }
    function discard() {
        if (!baseline) return;
        setDraft(baseline); setJsonText(pretty(baseline)); setJsonError(""); setMessage("");
    }
    function save() {
        if (!access || !editable || !draft || !dirty || jsonError) return;
        let parsed: Settings;
        try { parsed = parseSettings({ serverConfig: draft.serverConfig, modConfig: draft.modConfig }); }
        catch { setMessage("Some values are missing or out of range. Check the fields marked as invalid."); return; }
        setMessage("");
        startTransition(async () => {
            const saved: string[] = [];
            let next = live;
            for (const part of ["server", "mod"] as const) {
                const current = next[part];
                const settings = part === "server" ? parsed.serverConfig : parsed.modConfig;
                if (!current || sameSettings(settings, current.settings)) continue;
                const body = { serverId: access.serverId, configPart: part, expectedRevision: current.revision, settings };
                const encoded = JSON.stringify(body);
                const previous = requests.current[part];
                // A lost response is retried with the same request so the runner replays instead of re-applying.
                const requestId = previous?.body === encoded ? previous.requestId : crypto.randomUUID();
                requests.current[part] = { requestId, body: encoded };
                let response: Awaited<ReturnType<typeof saveManagedServerConfig>> | null = null;
                try { response = await saveManagedServerConfig({ requestId, ...body }, access.userId); } catch { response = null; }
                if (!response?.ok) {
                    response ??= { ok: false, message: "Connection interrupted. Save again to retry the same request.", reload: false, notSubmitted: false };
                    if (response.reload || response.notSubmitted) requests.current[part] = null;
                    setStale(response.reload);
                    setMessage([...saved.map((name) => `Saved ${name}.`), response.message].join(" "));
                    return;
                }
                requests.current[part] = null;
                next = { ...next, [part]: response.file };
                setLive(next);
                saved.push(part === "server" ? "server settings" : "gameplay settings");
            }
            setDraft(parsed); setJsonText(pretty(parsed));
            setMessage(saved.length ? `Saved ${saved.join(" and ")}. Restart the server to apply the new settings.` : "No changes to save.");
        });
    }

    const status = !access ? (stored ? "Only the server owner can edit configuration. This is the stored managed configuration." : "Configuration is unavailable for this server.")
        : loadState === "loading" ? "Loading the server's current configuration…"
        : loadState === "failed" ? loadMessage
        : access.canEdit ? "Editing the files on the server's runner. Changes apply the next time the server starts." : "Only the server owner can edit configuration.";

    return <div className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2" role="group" aria-label="Config editor mode">
                <button type="button" disabled={!draft} aria-pressed={mode === "form"} className={mode === "form" ? filePrimaryButtonClass : fileButtonClass} onClick={() => switchMode("form")}>Form</button>
                <button type="button" disabled={!draft} aria-pressed={mode === "json"} className={mode === "json" ? filePrimaryButtonClass : fileButtonClass} onClick={() => switchMode("json")}>JSON</button>
            </div>
            {access && <button type="button" className={fileButtonClass} disabled={loadState === "loading" || pending} onClick={reload}><RefreshCw aria-hidden className="size-4" />Reload settings</button>}
        </div>
        <p id="config-help" role={loadState === "failed" ? "alert" : undefined} className="mb-4 flex items-start gap-2 text-xs leading-5 text-foreground-muted">
            {loadState === "loading" && <LoaderCircle aria-hidden className="mt-0.5 size-3.5 shrink-0 animate-spin" />}{status}
        </p>
        {draft && mode === "json" && <>
            <label htmlFor="config-json" className="mb-2 block text-xs text-foreground-muted">Managed configuration · JSON</label>
            <textarea id="config-json" spellCheck={false} disabled={!editable} value={jsonText} onChange={(event) => editJson(event.target.value)} aria-invalid={jsonError ? true : undefined} aria-describedby={jsonError ? "config-json-error config-help" : "config-help"} className="min-h-64 w-full resize-y rounded-md border border-white/15 bg-background px-3 py-2.5 font-mono text-sm leading-7 text-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-red-400" />
            {jsonError && <p id="config-json-error" role="alert" className="mt-2 text-sm text-red-200">{jsonError}</p>}
        </>}
        {draft && mode === "form" && <div className="space-y-6">
            {GROUPS.map(({ group, title, description, fields }) => <fieldset key={group} disabled={!editable} className="min-w-0">
                <legend className="text-sm font-semibold">{title}</legend>
                <p className="mt-1 text-xs leading-5 text-foreground-muted">{description}</p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    {fields.map((field) => {
                        const id = `config-${group}-${field.key}`;
                        const value = groupValues(draft, group)[field.key];
                        const update = (next: unknown) => { setDraft(withValue(draft, group, field.key, next)); setMessage(""); };
                        if (field.kind === "boolean") return <label key={field.key} htmlFor={id} className="flex items-start gap-3 text-sm">
                            <input id={id} type="checkbox" className="mt-1 accent-gold" checked={value === true} onChange={(event) => update(event.target.checked)} />
                            <span>{field.label}{field.help && <span className="mt-1 block text-xs text-foreground-muted">{field.help}</span>}</span>
                        </label>;
                        if (field.kind === "choice") return <div key={field.key}>
                            <label htmlFor={id} className="text-sm">{field.label}</label>
                            <select id={id} className={inputClass} value={typeof value === "string" ? value : ""} onChange={(event) => update(event.target.value)}>
                                {field.options.map((option) => <option key={option} value={option}>{humanize(option)}</option>)}
                            </select>
                        </div>;
                        const problem = numberProblem(field, value);
                        return <div key={field.key}>
                            <label htmlFor={id} className="text-sm">{field.label}</label>
                            <input id={id} type="number" inputMode={field.kind === "integer" ? "numeric" : "decimal"} min={field.min} max={field.max} step={field.kind === "integer" ? 1 : field.step}
                                className={inputClass} value={typeof value === "number" && !Number.isNaN(value) ? value : ""} aria-invalid={problem ? true : undefined} aria-describedby={problem || field.help ? `${id}-help` : undefined}
                                onChange={(event) => update(event.target.value === "" ? Number.NaN : Number(event.target.value))} />
                            {(problem || field.help) && <p id={`${id}-help`} className={`mt-1 text-xs ${problem ? "text-red-200" : "text-foreground-muted"}`}>{problem ?? field.help}</p>}
                        </div>;
                    })}
                </div>
            </fieldset>)}
        </div>}
        {notice}
        {message && <p role="status" className="mt-4 border-l-2 border-gold bg-gold/[0.07] px-4 py-3 text-sm text-foreground-muted">{pending && <LoaderCircle aria-hidden className="mr-2 inline size-4 animate-spin" />}{message}{stale && <> <button type="button" className="underline" onClick={reload}>Reload settings</button></>}</p>}
        <div className={`sticky bottom-0 z-10 -mx-5 -mb-5 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t bg-surface px-5 py-4 ${dirty ? "border-gold/60 bg-linear-to-r from-gold/15 to-gold/5" : "border-white/10"}`}>
            <p className="text-sm text-foreground-muted">{dirty ? <span className="flex items-center gap-2 font-semibold text-gold"><CircleAlert className="size-4 shrink-0" aria-hidden="true" />Unsaved changes to {dirtyParts.join(" and ")}</span> : "No pending changes"}</p>
            <div className="ml-auto flex gap-2">
                <button type="button" disabled={!dirty || pending} className={fileButtonClass} onClick={discard}>Discard</button>
                <button type="button" disabled={!dirty || !editable || !!jsonError || problems.length > 0} className={filePrimaryButtonClass} onClick={save}>{pending ? "Saving…" : "Save config"}</button>
            </div>
        </div>
    </div>;
}
