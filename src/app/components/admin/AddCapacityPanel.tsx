"use client";

import { useState, type ReactNode } from "react";
import { ADD_CAPACITY_SUMMARY, AddCapacityDialog, type AddCapacityTab } from "./AddCapacityDialog";

const BUTTON_CLASS = "cursor-pointer border border-gold/40 px-4 py-2 font-label text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-gold hover:bg-gold/10 focus-visible:outline-2 focus-visible:outline-gold";

/** The VPS view's "Adding capacity" banner: its two buttons open the Add capacity dialog on the provider or manual tab. */
export function AddCapacityPanel({ provider, manual }: { provider: ReactNode; manual: ReactNode }) {
    const [openTab, setOpenTab] = useState<AddCapacityTab | null>(null);
    return <>
        <div className="mt-5 flex flex-col justify-between gap-3 border border-gold/25 bg-gold/8 p-4 sm:flex-row sm:items-center">
            <p className="text-xs leading-5 text-foreground-muted"><span className="font-semibold text-foreground">Adding capacity:</span> {ADD_CAPACITY_SUMMARY}</p>
            <div className="flex shrink-0 flex-wrap gap-2">
                <button type="button" aria-haspopup="dialog" onClick={() => setOpenTab("provider")} className={BUTTON_CLASS}>Onboard VPS</button>
                <button type="button" aria-haspopup="dialog" onClick={() => setOpenTab("manual")} className={BUTTON_CLASS}>Add manual VPS</button>
            </div>
        </div>
        {openTab !== null && <AddCapacityDialog
            initialTab={openTab}
            provider={provider}
            manual={manual}
            onClose={() => setOpenTab(null)}
        />}
    </>;
}
