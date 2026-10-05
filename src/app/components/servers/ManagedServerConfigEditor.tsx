"use client";

import { configurationMessages } from "@/app/servers/managed-server-messages";

import { useTranslations } from "@/app/lib/localization/client";
import type { Translator } from "@/app/lib/localization/types";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { readManagedServerConfigFiles, saveManagedServerConfig } from "@/app/servers/managed-server-config-actions";
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

const inputClass = "mt-2 block w-full min-w-0 rounded-md border border-white/15 bg-background px-3 py-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-red-400";

// Resolves the label for an unchanged configuration choice value.
function configurationChoiceLabel(value: string, t: Translator["t"]) {
    return t(`configuration.option.${value}`);
}
// Selects the configuration group without modifying its values.
function groupValues(settings: Settings, group: Group): Record<string, unknown> {
    return (group === "serverConfig" ? settings.serverConfig : settings.modConfig[group]) as unknown as Record<string, unknown>;
}
// Updates the selected draft setting without altering other configuration.
function withValue(settings: Settings, group: Group, key: string, value: unknown): Settings {
    if (group === "serverConfig") return { ...settings, serverConfig: { ...settings.serverConfig, [key]: value } };
    return { ...settings, modConfig: { ...settings.modConfig, [group]: { ...settings.modConfig[group], [key]: value } } };
}
// Reports the existing numeric validation rule using injected presentation.
function numberProblem(field: Field, value: unknown, t: Translator["t"], number: Translator["number"]): string | null {
    if (field.kind !== "integer" && field.kind !== "number") return null;
    if (typeof value !== "number" || Number.isNaN(value)) return t("configEditor.enterANumber");
    if (field.kind === "integer" && !Number.isInteger(value)) return t("configEditor.enterAWholeNumber");
    if (value < field.min || value > field.max) return t("configEditor.enterAValueFromMinToMax", { min: number(field.min), max: number(field.max) });
    return null;
}
// Serializes editable configuration without translating its payload.
function pretty(settings: Settings) { return JSON.stringify({ serverConfig: settings.serverConfig, modConfig: settings.modConfig }, null, 2); }
// Validates configuration shape and injects detailed parser diagnostics.
function parseSettings(value: unknown, t: Translator["t"]): Settings {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(t("configEditor.expectedAnObjectWithServerconfigAndModconfig"));
    const keys = Object.keys(value);
    if (keys.length !== 2 || !("serverConfig" in value) || !("modConfig" in value)) throw new Error(t("configEditor.expectedExactlyServerconfigAndModconfig"));
    const parsed = parseManagedServerConfiguration({ schemaVersion: 1, ...(value as object) }, configurationMessages(t));
    return { serverConfig: parsed.serverConfig, modConfig: parsed.modConfig };
}
// Compares serialized settings to detect unsaved changes.
function sameSettings(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
// Finds a JSON syntax error's line and column from the position the browser reports, when it reports one.
function jsonErrorLocation(text: string, error: SyntaxError) {
    const lineColumn = /line (\d+) column (\d+)/u.exec(error.message);
    if (lineColumn) return { line: Number(lineColumn[1]), column: Number(lineColumn[2]) };
    const position = /position (\d+)/u.exec(error.message);
    if (!position) return null;
    const before = text.slice(0, Number(position[1])).split("\n");
    return { line: before.length, column: before.at(-1)!.length + 1 };
}
// Keeps the browser's description of a JSON error without its location wording, which is shown separately.
function jsonErrorDetail(error: SyntaxError) {
    return error.message.replace(/^JSON\.parse: /u, "").replace(/\s+(?:in JSON )?at (?:position \d+|line \d+ column \d+).*$/u, "").trim();
}
// Describes invalid JSON with its location when known.
function jsonSyntaxMessage(text: string, error: SyntaxError, t: Translator["t"]) {
    const location = jsonErrorLocation(text, error);
    const detail = jsonErrorDetail(error) || error.message;
    return location
        ? t("configEditor.thisIsnTValidJsonLineColumnDetail", { line: location.line, column: location.column, detail })
        : t("configEditor.thisIsnTValidJsonDetail", { detail });
}

// Keys editable configuration state to the current account and server.
export function ManagedServerConfigEditor({ configuration, access, notice }: { configuration?: ManagedServerConfiguration; access?: ConfigAccess; notice?: ReactNode }) {
    return <ConfigSession key={access ? `${access.userId}:${access.serverId}` : "preview"} configuration={configuration} access={access} notice={notice} />;
}

// Presents live configuration editing and localized validation feedback.
function ConfigSession({ configuration, access, notice }: { configuration?: ManagedServerConfiguration; access?: ConfigAccess; notice?: ReactNode }) {
    const { t, number, locale } = useTranslations("managed-server");
    const SERVER_FIELDS: Field[] = [
        { key: "autosaveMinutes", label: t("configuration.field.autosaveMinutes"), kind: "integer", min: 0, max: 1440, help: t("configEditor.0TurnsAutosaveOff") },
        { key: "logFile", label: t("configuration.field.logFile"), kind: "boolean" },
        { key: "steam", label: t("configuration.field.steam"), kind: "boolean" },
        { key: "traceTick", label: t("configuration.field.traceTick"), kind: "boolean" },
        { key: "tracePublish", label: t("configuration.field.tracePublish"), kind: "boolean" },
        { key: "traceBandits", label: t("configuration.field.traceBandits"), kind: "boolean" },
    ];
    const DIFFICULTY_FIELDS: Field[] = [
        { key: "playerReceivedDamage", label: t("configuration.field.playerReceivedDamage"), kind: "choice", options: MANAGED_DIFFICULTY_LEVELS },
        { key: "playerTroopsReceivedDamage", label: t("configuration.field.playerTroopsReceivedDamage"), kind: "choice", options: MANAGED_DIFFICULTY_LEVELS },
        { key: "combatAIDifficulty", label: t("configuration.field.combatAIDifficulty"), kind: "choice", options: MANAGED_DIFFICULTY_LEVELS },
        { key: "recruitmentDifficulty", label: t("configuration.field.recruitmentDifficulty"), kind: "choice", options: MANAGED_DIFFICULTY_LEVELS },
        { key: "playerMapMovementSpeed", label: t("configuration.field.playerMapMovementSpeed"), kind: "choice", options: MANAGED_DIFFICULTY_LEVELS },
        { key: "stealthAndDisguiseDifficulty", label: t("configuration.field.stealthAndDisguiseDifficulty"), kind: "choice", options: MANAGED_DIFFICULTY_LEVELS },
        { key: "persuasionSuccessChance", label: t("configuration.field.persuasionSuccessChance"), kind: "choice", options: MANAGED_DIFFICULTY_LEVELS },
        { key: "clanMemberDeathChance", label: t("configuration.field.clanMemberDeathChance"), kind: "choice", options: MANAGED_DIFFICULTY_LEVELS },
        { key: "battleDeath", label: t("configuration.field.battleDeath"), kind: "choice", options: MANAGED_DIFFICULTY_LEVELS },
        { key: "birthAndDeath", label: t("configuration.field.birthAndDeath"), kind: "boolean" },
        { key: "autoAllocateClanMemberPerks", label: t("configuration.field.autoAllocateClanMemberPerks"), kind: "boolean" },
    ];
    const MOD_OPTION_FIELDS: Field[] = [
        { key: "fastForwardEnabled", label: t("configuration.field.fastForwardEnabled"), kind: "boolean" },
        { key: "autoPauseEnabled", label: t("configuration.field.autoPauseEnabled"), kind: "boolean" },
        { key: "clientsCanUseCheats", label: t("configuration.field.clientsCanUseCheats"), kind: "boolean" },
        { key: "goldFoodInfluenceChangeInSettlements", label: t("configuration.field.goldFoodInfluenceChangeInSettlements"), kind: "boolean" },
        { key: "goldFoodInfluenceChangeInBattles", label: t("configuration.field.goldFoodInfluenceChangeInBattles"), kind: "choice", options: MANAGED_GOLD_FOOD_CHANGE_MODES },
        { key: "goldFoodInfluenceChangeForDisconnectedPlayers", label: t("configuration.field.goldFoodInfluenceChangeForDisconnectedPlayers"), kind: "boolean" },
        { key: "playerBattleAiJoinWindowHours", label: t("configuration.field.playerBattleAiJoinWindowHours"), kind: "integer", min: 0, max: 8760 },
        { key: "speedLimitWhilePlayersInBattle", label: t("configuration.field.speedLimitWhilePlayersInBattle"), kind: "boolean" },
        { key: "wandererLimit", label: t("configuration.field.wandererLimit"), kind: "integer", min: 0, max: 1000 },
        { key: "wandererLimitScalesWithPlayers", label: t("configuration.field.wandererLimitScalesWithPlayers"), kind: "boolean" },
        { key: "playerKingdomClanTierRequired", label: t("configuration.field.playerKingdomClanTierRequired"), kind: "integer", min: 0, max: 6 },
        { key: "smithingStaminaRecoveryOutsideSettlements", label: t("configuration.field.smithingStaminaRecoveryOutsideSettlements"), kind: "boolean" },
        { key: "smithingStaminaRecoveryMultiplier", label: t("configuration.field.smithingStaminaRecoveryMultiplier"), kind: "number", min: 0, max: 100, step: 0.01 },
        { key: "maximumLootersMultiplier", label: t("configuration.field.maximumLootersMultiplier"), kind: "number", min: 0, max: 100, step: 0.1 },
        { key: "looterPartySizeMultiplier", label: t("configuration.field.looterPartySizeMultiplier"), kind: "number", min: 0, max: 100, step: 0.1 },
        { key: "lordDefectionRetries", label: t("configuration.field.lordDefectionRetries"), kind: "choice", options: MANAGED_LORD_DEFECTION_RETRY_MODES },
        { key: "enableHeroExecutions", label: t("configuration.field.enableHeroExecutions"), kind: "boolean" },
        { key: "enablePlayerClanMemberExecutions", label: t("configuration.field.enablePlayerClanMemberExecutions"), kind: "boolean" },
    ];
    const GROUPS: { group: Group; title: string; description: string; fields: Field[] }[] = [
        { group: "serverConfig", title: t("configEditor.serverSettings"), description: t("configEditor.savedToServerConfigJsonPasswordsPortsAndCampaignSelection"), fields: SERVER_FIELDS },
        { group: "difficulty", title: t("configEditor.difficulty"), description: t("configEditor.savedToModConfigJson"), fields: DIFFICULTY_FIELDS },
        { group: "modOptions", title: t("configEditor.gameplayOptions"), description: t("configEditor.savedToModConfigJson"), fields: MOD_OPTION_FIELDS },
    ];
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
            const files = await readManagedServerConfigFiles(serverId, userId).catch(() => null);
            if (cancelled) return;
            const server = files?.server ?? null;
            const mod = files?.mod ?? null;
            if (server?.ok && mod?.ok && server.file.configPart === "server" && mod.file.configPart === "mod") {
                const settings: Settings = { serverConfig: server.file.settings, modConfig: mod.file.settings };
                setLive({ server: server.file, mod: mod.file });
                setDraft(settings); setJsonText(pretty(settings)); setJsonError(""); setStale(false);
                setLoadState("ready");
            } else {
                setLoadMessage((server && !server.ok ? server.message : mod && !mod.ok ? mod.message : null) ?? t("configEditor.theLiveConfigurationCouldNotBeLoadedTryAgain"));
                setLoadState("failed");
            }
        })();
        return () => { cancelled = true; };
    }, [serverId, userId, loadVersion]);

    const baseline: Settings | null = loadState === "ready" && live.server && live.mod
        ? { serverConfig: live.server.settings as Settings["serverConfig"], modConfig: live.mod.settings as Settings["modConfig"] } : stored;
    const editable = access?.canEdit === true && loadState === "ready" && !pending;
    const dirtyParts = draft && baseline ? ([
        ...(sameSettings(draft.serverConfig, baseline.serverConfig) ? [] : [t("configEditor.serverSettings2")]),
        ...(sameSettings(draft.modConfig, baseline.modConfig) ? [] : [t("configEditor.gameplaySettings")]),
    ]) : [];
    // JSON that does not parse yet is still an edit the user may want to discard.
    const dirty = dirtyParts.length > 0 || jsonError !== "";
    const problems = draft ? GROUPS.flatMap(({ group, fields }) => fields.filter((field) => numberProblem(field, groupValues(draft, group)[field.key], t, number) !== null)) : [];

    // Reloads current configuration, confirming first when that would discard unsaved edits.
    function reload() {
        if (!access) return;
        if (dirty && !window.confirm(t("configEditor.reloadTheSettingsFromTheServerYourUnsavedChangesWillBeLost"))) return;
        setLoadState("loading"); setMessage(""); setStale(false); setLoadVersion((value) => value + 1);
    }
    // Switches views; invalid JSON can be left behind after confirming its edits will be dropped.
    function switchMode(next: "form" | "json") {
        if (next === mode || !draft) return;
        if (next === "json") setJsonText(pretty(draft));
        else if (jsonError) {
            if (!window.confirm(t("configEditor.switchToTheFormYourJsonEditsSinceItWasLastValidWillBeDiscarded"))) return;
            setJsonText(pretty(draft)); setJsonError("");
        }
        setMessage("");
        setMode(next);
    }
    // Parses a JSON draft and reports validation without changing saved settings.
    function editJson(text: string) {
        setJsonText(text); setMessage("");
        try { setDraft(parseSettings(JSON.parse(text), t)); setJsonError(""); }
        catch (error) { setJsonError(error instanceof SyntaxError ? jsonSyntaxMessage(text, error, t) : error instanceof Error ? error.message : t("configEditor.unsupportedSettings")); }
    }
    // Restores the draft from the last confirmed configuration.
    function discard() {
        if (!baseline) return;
        setDraft(baseline); setJsonText(pretty(baseline)); setJsonError(""); setMessage("");
    }
    // Submits the existing settings operation and presents its outcome.
    function save() {
        if (!access || !editable || !draft || !dirty || jsonError) return;
        let parsed: Settings;
        try { parsed = parseSettings({ serverConfig: draft.serverConfig, modConfig: draft.modConfig }, t); }
        catch { setMessage(t("configEditor.someValuesAreMissingOrOutOfRangeCheckThe")); return; }
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
                    response ??= { ok: false, message: t("configEditor.connectionInterruptedSaveAgainToRetryTheSameRequest"), reload: false, notSubmitted: false };
                    if (response.reload || response.notSubmitted) requests.current[part] = null;
                    setStale(response.reload);
                    setMessage([...saved.map((name) => t("configEditor.savedName", { name: name })), response.message].join(" "));
                    return;
                }
                requests.current[part] = null;
                next = { ...next, [part]: response.file };
                setLive(next);
                saved.push(part === "server" ? t("configEditor.serverSettings2") : t("configEditor.gameplaySettings"));
            }
            setDraft(parsed); setJsonText(pretty(parsed));
            setMessage(saved.length ? t("configEditor.savedValue1RestartTheServerToApplyTheNewSettings", { value1: new Intl.ListFormat(locale, { type: "conjunction" }).format(saved) }) : t("configEditor.noChangesToSave"));
        });
    }

    const status = !access ? (stored ? t("configEditor.onlyTheServerOwnerCanEditConfigurationThisIsThe") : t("configEditor.configurationIsUnavailableForThisServer"))
        : loadState === "loading" ? t("configEditor.loadingTheServerSCurrentConfiguration")
        : loadState === "failed" ? loadMessage
        : access.canEdit ? t("configEditor.editingTheFilesOnTheServerSRunner") : t("configEditor.onlyTheServerOwnerCanEditConfiguration");

    return <div className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2" role="group" aria-label={t("configEditor.configEditorMode")}>
                <button type="button" disabled={!draft} aria-pressed={mode === "form"} className={mode === "form" ? filePrimaryButtonClass : fileButtonClass} onClick={() => switchMode("form")}>{t("configEditor.form")}</button>
                <button type="button" disabled={!draft} aria-pressed={mode === "json"} className={mode === "json" ? filePrimaryButtonClass : fileButtonClass} onClick={() => switchMode("json")}>{t("configEditor.json")}</button>
            </div>
            {access && <button type="button" className={fileButtonClass} disabled={loadState === "loading" || pending} onClick={reload}><RefreshCw aria-hidden className="size-4" />{t("configEditor.reloadSettings")}</button>}
        </div>
        <p id="config-help" role={loadState === "failed" ? "alert" : undefined} className="mb-4 flex items-start gap-2 text-xs leading-5 text-foreground-muted">
            {loadState === "loading" && <LoaderCircle aria-hidden className="mt-0.5 size-3.5 shrink-0 animate-spin" />}{status}
        </p>
        {draft && mode === "json" && <>
            <label htmlFor="config-json" className="mb-2 block text-xs text-foreground-muted">{t("configEditor.managedConfigurationJson")}</label>
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
                                {field.options.map((option) => <option key={option} value={option}>{configurationChoiceLabel(option, t)}</option>)}
                            </select>
                        </div>;
                        const problem = numberProblem(field, value, t, number);
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
        {message && <p role="status" className="mt-4 border-l-2 border-gold bg-gold/[0.07] px-4 py-3 text-sm text-foreground-muted">{pending && <LoaderCircle aria-hidden className="mr-2 inline size-4 animate-spin" />}{message}{stale && <> <button type="button" className="underline" onClick={reload}>{t("configEditor.reloadSettings")}</button></>}</p>}
        {/* Root overflow clipping defeats position: sticky, so unsaved changes pin the bar to the viewport instead. */}
        {dirty && <div aria-hidden="true" className="h-20" />}
        <div data-unsaved-bar={dirty ? "pinned" : undefined} className={dirty ? "fixed inset-x-0 bottom-0 z-30 border-t border-gold/60 bg-surface shadow-[0_-12px_32px_rgba(0,0,0,0.45)]" : "-mx-5 -mb-5 mt-5 rounded-b-lg border-t border-white/10 bg-surface"}>
            <div className={dirty ? "bg-linear-to-r from-gold/15 to-gold/5" : ""}>
                <div className={`flex flex-wrap items-center justify-between gap-3 py-4 ${dirty ? "site-container" : "px-5"}`}>
                    <p className="text-sm text-foreground-muted">{dirty ? <span className="flex items-center gap-2 font-semibold text-gold"><CircleAlert className="size-4 shrink-0" aria-hidden="true" />{jsonError ? t("configEditor.theJsonHasUnsavedEditsThatArenTValidYet") : t("configEditor.unsavedChanges", { settings: new Intl.ListFormat(locale, { type: "conjunction" }).format(dirtyParts) })}</span> : t("configEditor.noPendingChanges")}</p>
                    <div className="ml-auto flex gap-2">
                        <button type="button" disabled={!dirty || pending} className={fileButtonClass} onClick={discard}>{t("configEditor.discard")}</button>
                        <button type="button" disabled={!dirty || !editable || !!jsonError || problems.length > 0} className={filePrimaryButtonClass} onClick={save}>{pending ? t("configEditor.saving") : t("configEditor.saveConfig")}</button>
                    </div>
                </div>
            </div>
        </div>
    </div>;
}
