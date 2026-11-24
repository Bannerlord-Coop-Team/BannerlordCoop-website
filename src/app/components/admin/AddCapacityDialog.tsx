"use client";

import { X } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { tabKeyStep } from "@/app/lib/tab-navigation";
import { useModalDialog } from "@/app/lib/use-modal-dialog";

/** The dialog's two onboarding sources: a provider account's inventory, or facts typed in by hand. */
export type AddCapacityTab = "provider" | "manual";

/** What adding capacity does, shared by the VPS view's banner and the dialog's introduction. */
export const ADD_CAPACITY_SUMMARY = "Onboard an already-purchased VPS, from a provider account (OVHcloud, Contabo) or by manual entry for a provider without an account API. The durable workflow verifies the host, installs the reviewed runner, prepares every isolated slot, establishes private mTLS routes, and exposes capacity only after health proof.";

const TABS: ReadonlyArray<{ tab: AddCapacityTab; label: string }> = [
    { tab: "provider", label: "Provider account" },
    { tab: "manual", label: "Manual entry" },
];
const TAB_CLASS = "inline-flex min-h-10 shrink-0 items-center border px-4 font-label text-[0.68rem] font-semibold uppercase tracking-[0.12em] focus-visible:outline-2 focus-visible:outline-gold";
const SELECTED_TAB_CLASS = "border-gold/40 bg-gold/10 text-gold";
const IDLE_TAB_CLASS = "border-white/10 text-foreground-muted hover:border-white/25 hover:text-foreground";

/** The "Add capacity" modal: opens on one tab, switches between the provider and manual panels, and closes. */
export function AddCapacityDialog({ initialTab, provider, manual, onClose }: {
    initialTab: AddCapacityTab;
    provider: ReactNode;
    manual: ReactNode;
    onClose: () => void;
}) {
    const id = useId();
    const dialogRef = useRef<HTMLDialogElement>(null);
    // Points at the tab selected when the dialog opens, which receives focus then.
    const openingTabRef = useRef<HTMLButtonElement>(null);
    const [tab, setTab] = useState<AddCapacityTab>(initialTab);
    const tabId = (value: AddCapacityTab) => `${id}-tab-${value}`;
    const panelId = (value: AddCapacityTab) => `${id}-panel-${value}`;
    useModalDialog(dialogRef, openingTabRef);

    /** Moves the selection and focus between tabs with the arrow, Home and End keys. */
    function moveTab(event: KeyboardEvent<HTMLButtonElement>) {
        const position = TABS.findIndex((entry) => entry.tab === tab);
        const step = tabKeyStep(event.key, position, TABS.length);
        if (step === null) return;
        event.preventDefault();
        const next = TABS[step]!.tab;
        setTab(next);
        document.getElementById(tabId(next))?.focus();
    }

    return (
        <dialog
            ref={dialogRef}
            aria-modal="true"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-description`}
            onCancel={(event) => { event.preventDefault(); onClose(); }}
            className="fixed inset-0 m-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-2xl overflow-y-auto border border-gold/30 bg-surface-raised p-0 text-foreground shadow-2xl backdrop:bg-black/70 sm:max-h-[calc(100dvh-3rem)]"
        >
            <div className="border-t-2 border-gold p-4 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-gold">VPS inventory</p>
                        <h2 id={`${id}-title`} className="mt-2 font-display text-3xl font-semibold">Add capacity</h2>
                    </div>
                    <button type="button" aria-label="Close" onClick={onClose} className="flex size-10 shrink-0 items-center justify-center border border-white/15 text-foreground-muted transition-colors hover:border-gold/50 hover:text-gold focus-visible:outline-2 focus-visible:outline-gold">
                        <X aria-hidden="true" className="size-5" />
                    </button>
                </div>
                <p id={`${id}-description`} className="mt-3 text-xs leading-5 text-foreground-muted">{ADD_CAPACITY_SUMMARY}</p>
                <div role="tablist" aria-label="Onboarding source" className="mt-5 flex gap-2 overflow-x-auto border-b border-white/10 pb-3">
                    {TABS.map(({ tab: value, label }) => (
                        <button
                            key={value}
                            ref={value === initialTab ? openingTabRef : undefined}
                            type="button"
                            role="tab"
                            id={tabId(value)}
                            aria-selected={tab === value}
                            aria-controls={panelId(value)}
                            tabIndex={tab === value ? 0 : -1}
                            onClick={() => setTab(value)}
                            onKeyDown={moveTab}
                            className={`${TAB_CLASS} ${tab === value ? SELECTED_TAB_CLASS : IDLE_TAB_CLASS}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                {/* Both panels stay mounted so a half-typed form or a submission result survives switching tabs. */}
                <div role="tabpanel" id={panelId("provider")} aria-labelledby={tabId("provider")} hidden={tab !== "provider"} className="mt-4">{provider}</div>
                <div role="tabpanel" id={panelId("manual")} aria-labelledby={tabId("manual")} hidden={tab !== "manual"} className="mt-4">{manual}</div>
            </div>
        </dialog>
    );
}
