import { Globe2, LockKeyhole } from "lucide-react";

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-40";

export function ServerSettingsPanel({ name, visibility }: { name: string; visibility?: "private" | "public" }) {
    return <section aria-labelledby="server-settings-heading" className="min-w-0 rounded-lg border border-white/10 bg-surface">
        <div className="border-b border-white/10 p-5">
            <h2 id="server-settings-heading" className="text-base font-semibold">Server settings</h2>
            <p className="mt-1 text-sm leading-6 text-foreground-muted">Read-only settings. Editing and saving from this panel are not connected yet.</p>
        </div>
        <div className="max-w-3xl space-y-5 p-5">
            <div>
                <label htmlFor="settings-server-name" className="text-sm font-medium">Server name</label>
                <input id="settings-server-name" disabled value={name} className="mt-2 w-full rounded-md border border-white/15 bg-background px-3 py-2.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50" />
                <p className="mt-2 text-xs leading-5 text-foreground-muted">The server display name. Use the header edit control where available.</p>
            </div>
            <fieldset disabled>
                <legend className="text-sm font-medium">Directory visibility</legend>
                <p className="mt-2 text-sm leading-6 text-foreground-muted">Discovery preference only; public listing is not available yet. Visibility does not grant management access or change game connection permissions.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {([{ value: "private", title: "Private", description: "Not opted in to public discovery.", icon: LockKeyhole }, { value: "public", title: "Public", description: "Opted in to public discovery when available.", icon: Globe2 }] as const).map(({ value, title, description, icon: Icon }) => <label key={value} className={`flex cursor-not-allowed items-start gap-3 rounded-md border p-4 opacity-50 ${visibility === value ? "border-gold/50 bg-gold/5" : "border-white/10"}`}>
                        <input disabled type="radio" name="settings-visibility" value={value} checked={visibility === value} readOnly className="mt-1 accent-gold" />
                        <span><span className="flex items-center gap-2 text-sm font-medium"><Icon className={`size-4 ${visibility === value ? "text-gold" : "text-foreground-muted"}`} aria-hidden="true" />{title}</span><span className="mt-2 block text-xs leading-5 text-foreground-muted">{description}</span></span>
                    </label>)}
                </div>
                <p className="mt-3 text-xs leading-5 text-foreground-muted">{visibility ? "The owner can change this preference using the header visibility picker." : "Directory visibility is unavailable for this server."}</p>
            </fieldset>
        </div>
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t border-white/10 bg-surface px-5 py-4">
            <p className="text-sm text-foreground-muted">No pending changes</p>
            <div className="ml-auto flex gap-2"><button disabled className={button}>Discard</button><button disabled className={`${button} !border-gold/50 !bg-gold/15 !text-gold`}>Save settings</button></div>
        </div>
    </section>;
}
