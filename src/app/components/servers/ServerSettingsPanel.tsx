"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { renameLiveServer } from "@/app/servers/name-actions";
import { setServerVisibility } from "@/app/servers/server-visibility-actions";
import { Globe2, LockKeyhole } from "lucide-react";

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-40";

type Visibility = "private" | "public";
type VisibilityAccess = { serverId: string; expectedUpdatedAt: string; canEdit: boolean };

export function ServerSettingsPanel({ name, visibility, renameServerId, visibilityAccess }: {
    name: string; visibility?: Visibility; renameServerId?: string; visibilityAccess?: VisibilityAccess;
}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [nameState, setNameState] = useState({ source: name, saved: name, draft: name });
    const [visibilityState, setVisibilityState] = useState({ source: visibility, draft: visibility });
    const [message, setMessage] = useState("");
    const request = useRef<{ serverId: string; visibility: Visibility; expectedUpdatedAt: string; requestId: string } | null>(null);
    // Refreshes from either header control update that field without discarding the other draft.
    if (nameState.source !== name) setNameState({ source: name, saved: name, draft: name });
    if (visibilityState.source !== visibility) setVisibilityState({ source: visibility, draft: visibility });
    const canRename = !!renameServerId;
    const canChangeVisibility = visibilityAccess?.canEdit === true && visibility !== undefined;
    const nameDirty = canRename && nameState.draft.trim() !== nameState.saved;
    const visibilityDirty = canChangeVisibility && visibilityState.draft !== visibility;
    const dirty = nameDirty || visibilityDirty;

    function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (pending || !dirty || (nameDirty && !nameState.draft.trim())) return;
        if (visibilityDirty && visibilityState.draft === "public" && !window.confirm("Mark this server public for discovery? This records your opt-in preference; public listing is not available yet. It does not change game connection permissions.")) return;
        setMessage("");
        startTransition(async () => {
            const messages: string[] = [];
            try {
                if (nameDirty && renameServerId) {
                    const form = new FormData();
                    form.set("serverId", renameServerId);
                    form.set("displayName", nameState.draft.trim());
                    const result = await renameLiveServer(form);
                    if (!result.ok) { setMessage(result.error); return; }
                    setNameState(current => ({ ...current, saved: result.displayName, draft: result.displayName }));
                    messages.push("Server name saved.");
                }
                if (visibilityDirty && visibilityAccess && visibilityState.draft) {
                    if (!request.current || request.current.serverId !== visibilityAccess.serverId || request.current.visibility !== visibilityState.draft || request.current.expectedUpdatedAt !== visibilityAccess.expectedUpdatedAt) {
                        request.current = { serverId: visibilityAccess.serverId, visibility: visibilityState.draft, expectedUpdatedAt: visibilityAccess.expectedUpdatedAt, requestId: crypto.randomUUID() };
                    }
                    const result = await setServerVisibility(request.current);
                    messages.push(result.message);
                    if (result.ok) request.current = null;
                    // A receipt may be a replay. Only refreshed props establish the current visibility.
                }
                setMessage(messages.join(" "));
            } catch {
                setMessage([...messages, "The update could not be confirmed. Retry or refresh to check the current settings."].join(" "));
            } finally {
                router.refresh();
            }
        });
    }

    return <section aria-labelledby="server-settings-heading" className="min-w-0 rounded-lg border border-white/10 bg-surface">
        <div className="border-b border-white/10 p-5">
            <h2 id="server-settings-heading" className="text-base font-semibold">Server settings</h2>
            <p className="mt-1 text-sm leading-6 text-foreground-muted">Changes apply only when you save.</p>
        </div>
        <form onSubmit={save}>
        <div className="max-w-3xl space-y-5 p-5">
            <div>
                <label htmlFor="settings-server-name" className="text-sm font-medium">Server name</label>
                <input id="settings-server-name" disabled={!canRename || pending} required maxLength={80} value={nameState.draft} onChange={event => { setNameState(current => ({ ...current, draft: event.target.value })); setMessage(""); }} className="mt-2 w-full rounded-md border border-white/15 bg-background px-3 py-2.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50" />
                <p className="mt-2 text-xs leading-5 text-foreground-muted">{canRename ? "The server display name." : "Renaming is unavailable for this server or your access level."}</p>
            </div>
            <fieldset disabled={!canChangeVisibility || pending}>
                <legend className="text-sm font-medium">Directory visibility</legend>
                <p className="mt-2 text-sm leading-6 text-foreground-muted">Discovery preference only; public listing is not available yet. Visibility does not grant management access or change game connection permissions.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {([{ value: "private", title: "Private", description: "Not opted in to public discovery.", icon: LockKeyhole }, { value: "public", title: "Public", description: "Opted in to public discovery when available.", icon: Globe2 }] as const).map(({ value, title, description, icon: Icon }) => <label key={value} className={`flex items-start gap-3 rounded-md border p-4 ${!canChangeVisibility || pending ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${visibilityState.draft === value ? "border-gold/50 bg-gold/5" : "border-white/10"}`}>
                        <input disabled={!canChangeVisibility || pending} type="radio" name="settings-visibility" value={value} checked={visibilityState.draft === value} onChange={() => { setVisibilityState(current => ({ ...current, draft: value })); setMessage(""); }} className="mt-1 accent-gold" />
                        <span><span className="flex items-center gap-2 text-sm font-medium"><Icon className={`size-4 ${visibilityState.draft === value ? "text-gold" : "text-foreground-muted"}`} aria-hidden="true" />{title}</span><span className="mt-2 block text-xs leading-5 text-foreground-muted">{description}</span></span>
                    </label>)}
                </div>
                <p className="mt-3 text-xs leading-5 text-foreground-muted">{visibility ? canChangeVisibility ? "Choose a preference, then save settings." : "Only the server owner can change visibility." : "Directory visibility is unavailable for this server."}</p>
            </fieldset>
        </div>
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t border-white/10 bg-surface px-5 py-4">
            <div className="min-w-0 basis-full text-sm text-foreground-muted sm:flex-1"><p>{dirty ? "Unsaved changes" : "No pending changes"}</p><p role="status" className="mt-2">{message}</p></div>
            {dirty && <div className="ml-auto flex gap-2"><button type="button" disabled={pending} className={button} onClick={() => { setNameState(current => ({ ...current, draft: current.saved })); setVisibilityState({ source: visibility, draft: visibility }); setMessage(""); }}>Discard</button><button type="submit" disabled={pending || (nameDirty && !nameState.draft.trim())} className={`${button} !border-gold/50 !bg-gold/15 !text-gold`}>{pending ? "Saving…" : "Save settings"}</button></div>}
        </div>
        </form>
    </section>;
}
