import type { ReactNode } from "react";
import { Download, Upload } from "lucide-react";

export const fileButtonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-sm font-medium text-foreground transition hover:border-gold/50 hover:bg-gold/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40";

export function ServerSaveConfigPanels({ saveName, configuration, saveActions, configActions, saveNotice, configNotice }: {
    saveName?: string; configuration?: object; saveActions?: ReactNode; configActions?: ReactNode;
    saveNotice?: ReactNode; configNotice?: ReactNode;
}) {
    return <div className="space-y-5">
        <section aria-labelledby="campaign-save-heading" className="rounded-lg border border-white/10 bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                    <h2 id="campaign-save-heading" className="text-base font-semibold">Campaign save</h2>
                    <p className="mt-2 break-all font-mono text-sm">{saveName ?? "Campaign save unavailable"}</p>
                </div>
                <div className="flex flex-wrap gap-2">{saveActions ?? <>
                    <button disabled className={fileButtonClass}><Download className="size-4" aria-hidden="true" />Export save</button>
                    <button disabled className={fileButtonClass}><Upload className="size-4" aria-hidden="true" />Import save</button>
                </>}</div>
            </div>
            {saveNotice}
        </section>
        <section aria-labelledby="configuration-heading" className="min-w-0 rounded-lg border border-white/10 bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-5">
                <div><h2 id="configuration-heading" className="text-base font-semibold">Configuration</h2><p className="mt-1 text-sm leading-6 text-foreground-muted">Inline editing is not connected yet. Use file import to apply supported settings.</p></div>
            </div>
            <div className="p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex gap-2" role="group" aria-label="Config editor mode">
                        <button disabled aria-pressed="true" className={`${fileButtonClass} !border-gold/50 !bg-gold/15 !text-gold`}>JSON</button>
                        <button disabled aria-pressed="false" className={fileButtonClass}>Form preview</button>
                    </div>
                    <div className="flex gap-2">{configActions ?? <>
                        <button disabled className={fileButtonClass}><Upload className="size-4" aria-hidden="true" />Import config</button>
                        <button disabled className={fileButtonClass}><Download className="size-4" aria-hidden="true" />Export config</button>
                    </>}</div>
                </div>
                <label htmlFor="config-json" className="mb-2 block text-xs text-foreground-muted">Managed configuration · JSON preview</label>
                <textarea id="config-json" disabled value={configuration ? JSON.stringify(configuration, null, 2) : ""} placeholder="Configuration is unavailable for this server." aria-describedby="config-help" className="min-h-64 w-full resize-y rounded-md border border-white/15 bg-background px-3 py-2.5 font-mono text-sm leading-7 text-foreground disabled:cursor-not-allowed disabled:opacity-50" />
                <p id="config-help" className="mt-3 text-xs leading-5 text-foreground-muted">Read-only preview. JSON editing and form editing are unavailable.</p>
                {configNotice}
            </div>
            <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t border-white/10 bg-surface px-5 py-4">
                <p className="text-sm text-foreground-muted">No pending changes</p>
                <div className="ml-auto flex gap-2"><button disabled className={fileButtonClass}>Discard</button><button disabled className={`${fileButtonClass} !border-gold/50 !bg-gold/15 !text-gold`}>Save config</button></div>
            </div>
        </section>
    </div>;
}
