"use client";

import { useTranslations } from "@/app/lib/localization/client";
import { deleteMyServerSave, selectMyServerSave } from "@/app/lib/hosting/my-servers";
import type { MyServerSavePage } from "@/app/lib/control-plane/types";
import { useState, useTransition } from "react";

const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/15 px-3 py-2 text-sm text-foreground transition hover:border-gold hover:text-gold disabled:cursor-not-allowed disabled:opacity-50";

// Lets an owner choose which validated campaign the next Start should load.
export function ManagedServerSaveSelector({ userId, serverId, saves, canSelect }: {
    userId: string;
    serverId: string;
    saves: MyServerSavePage | null;
    canSelect: boolean;
}) {
    const { t, number } = useTranslations("managed-server");
    const [isPending, startTransition] = useTransition();
    const [selected, setSelected] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    if (saves === null) return null;
    const page = saves;

    function choose(saveId: string) {
        if (!canSelect || isPending || saveId === page.activeSaveId) return;
        setError(null);
        startTransition(async () => {
            try {
                await selectMyServerSave(userId, { serverId, saveId, expectedUpdatedAt: page.updatedAt }, crypto.randomUUID());
                setSelected(saveId);
                window.location.reload();
            } catch (cause) {
                setError(cause instanceof Error ? cause.message : t("transfers.theTransferCouldNotBeSubmitted"));
            }
        });
    }

    function remove(save: MyServerSavePage["items"][number]) {
        if (save.importedBy !== "owner" || isPending || !window.confirm(`Delete campaign "${save.displayName}"? Type the exact campaign name in the next prompt to confirm.`)) return;
        const confirmationText = window.prompt(`Type the exact campaign name to delete "${save.displayName}".`);
        if (confirmationText !== save.displayName) { setError(t("campaigns.deleteConfirmationMismatch")); return; }
        setError(null);
        startTransition(async () => {
            try { await deleteMyServerSave(userId, { serverId, saveId: save.saveId, expectedUpdatedAt: page.updatedAt, confirmationText }, crypto.randomUUID()); window.location.reload(); }
            catch (cause) { setError(cause instanceof Error ? cause.message : t("campaigns.deleteFailed")); }
        });
    }

    return <section className="mb-5 rounded-lg border border-white/10 bg-surface p-5 sm:p-6" aria-labelledby="campaign-selection-heading">
        <h2 id="campaign-selection-heading" className="text-base font-semibold text-foreground">{t("campaigns.title")}</h2>
        <p className="mt-2 text-sm leading-6 text-foreground-muted">{t("campaigns.description")}</p>
        {page.items.length === 0 ? <p className="mt-4 text-sm text-foreground-muted">{t("transfers.noActiveCampaignSave")}</p> : <ul className="mt-4 space-y-3">
            {page.items.map((save) => {
                const active = save.saveId === page.activeSaveId;
                return <li key={save.saveId} className="flex flex-wrap items-center justify-between gap-3 border border-white/10 px-4 py-3">
                    <div className="min-w-0"><p className="break-words text-sm font-semibold">{save.displayName}</p><p className="text-xs text-foreground-muted">{number(save.byteSize)} bytes{active ? ` · ${t("campaigns.current")}` : ""}</p></div>
                    <div className="flex items-center gap-2"><button type="button" className={buttonClass} disabled={!canSelect || active || isPending} onClick={() => choose(save.saveId)}>{active ? t("campaigns.current") : isPending && selected === save.saveId ? t("transfers.pleaseWait") : t("campaigns.select")}</button>{save.importedBy === "owner" && <button type="button" aria-label={`Delete ${save.displayName}`} className="inline-flex size-10 items-center justify-center rounded-md border border-crimson/50 text-xl text-red-200 hover:border-crimson disabled:opacity-50" disabled={isPending || active} onClick={() => remove(save)}>×</button>}</div>
                </li>;
            })}
        </ul>}
        {!canSelect && <p className="mt-3 text-xs leading-5 text-foreground-muted">{t("campaigns.selectionUnavailable")}</p>}
        {error && <p role="alert" className="mt-3 border-l-2 border-crimson bg-crimson/10 px-4 py-3 text-sm text-red-200">{error}</p>}
        {selected && !error && <p role="status" className="mt-3 border-l-2 border-emerald-500 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{t("campaigns.selected")}</p>}
    </section>;
}
