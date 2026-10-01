import type { ReactNode } from "react";
import { Download, Upload } from "lucide-react";
import { ManagedServerConfigEditor, type ConfigAccess } from "./ManagedServerConfigEditor";
import { fileButtonClass } from "./server-file-styles";
import type { ManagedServerConfiguration } from "../../../../supabase/functions/_shared/managed-server-configuration";

export { fileButtonClass } from "./server-file-styles";

export function ServerSaveConfigPanels({ saveName, configuration, configAccess, saveActions, configActions, saveNotice, configNotice }: {
    saveName?: string; configuration?: ManagedServerConfiguration; configAccess?: ConfigAccess; saveActions?: ReactNode; configActions?: ReactNode;
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
                <div><h2 id="configuration-heading" className="text-base font-semibold">Configuration</h2><p className="mt-1 text-sm leading-6 text-foreground-muted">Edit settings in the form or as JSON, then save. Changes apply the next time the server starts.</p></div>
                <div className="flex flex-wrap gap-2">{configActions ?? <>
                    <button disabled className={fileButtonClass}><Upload className="size-4" aria-hidden="true" />Import config</button>
                    <button disabled className={fileButtonClass}><Download className="size-4" aria-hidden="true" />Export config</button>
                </>}</div>
            </div>
            <ManagedServerConfigEditor configuration={configuration} access={configAccess} notice={configNotice} />
        </section>
    </div>;
}
