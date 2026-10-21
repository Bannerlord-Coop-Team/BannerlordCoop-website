"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "@/app/lib/localization/client";
import { removeServerManager, setServerManager } from "@/app/servers/server-manager-actions";
import type { ServerManager } from "@/app/lib/hosting/server-managers";

const button = "inline-flex min-h-10 items-center justify-center rounded-md border border-gold/50 bg-gold/10 px-4 py-2 text-sm font-semibold text-gold hover:bg-gold/15 focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40";
const removeButton = "inline-flex min-h-9 shrink-0 items-center justify-center rounded-md border border-crimson/50 px-3 py-1.5 text-sm font-semibold text-red-200 hover:border-crimson hover:bg-crimson/15 focus-visible:outline-2 focus-visible:outline-crimson disabled:cursor-not-allowed disabled:opacity-40";
const LIST_HEADING_ID = "managed-server-manager-list-heading";

/** Lets the owner list, grant and remove manager access; `managers` is null when the list could not be read. */
export function ManagedServerManagerAccess({ serverId, expectedUpdatedAt, canEdit, managers = null }: {
    serverId: string; expectedUpdatedAt: string; canEdit: boolean; managers?: readonly ServerManager[] | null;
}) {
    const { t } = useTranslations("managed-server");
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");
    // The last started action ("grant" or a manager account ID); it only labels a button while the transition is pending.
    const [pendingAction, setPendingAction] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();
    const listHeading = useRef<HTMLHeadingElement>(null);

    if (!canEdit) return null;

    // Submits the entered email as a new manager grant.
    function submit() {
        const form = new FormData();
        form.set("serverId", serverId);
        form.set("expectedUpdatedAt", expectedUpdatedAt);
        form.set("managerEmail", email);
        setMessage("");
        setPendingAction("grant");
        startTransition(async () => {
            const result = await setServerManager(form);
            setMessage(result.message);
            if (result.ok) setEmail("");
        });
    }

    // Revokes one confirmed manager; focus returns to the list heading, since the row is dropped or its button was disabled.
    function remove(manager: ServerManager, label: string) {
        if (!window.confirm(t("managerAccess.confirmRemove", { name: label }))) return;
        const form = new FormData();
        form.set("serverId", serverId);
        form.set("managerAccountId", manager.accountId);
        setMessage("");
        setPendingAction(manager.accountId);
        startTransition(async () => {
            const result = await removeServerManager(form);
            setMessage(result.message);
            listHeading.current?.focus();
        });
    }

    return <section aria-labelledby="managed-server-manager-heading" className="rounded-lg border border-white/10 bg-surface p-5 sm:p-6">
        <h2 id="managed-server-manager-heading" className="text-base font-semibold">{t("managerAccess.heading")}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-foreground-muted">{t("managerAccess.description")}</p>
        <div className="mt-5 max-w-xl">
            <h3 ref={listHeading} id={LIST_HEADING_ID} tabIndex={-1} className="text-sm font-medium outline-none">{t("managerAccess.currentManagers")}</h3>
            <ManagerList managers={managers} disabled={isPending} removingId={isPending ? pendingAction : null} onRemove={remove} />
        </div>
        <form className="mt-5 max-w-xl space-y-3" onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <label htmlFor="manager-account-email" className="block text-sm font-medium">{t("managerAccess.emailLabel")}</label>
            <input
                id="manager-account-email"
                name="managerEmail"
                type="email"
                required
                maxLength={320}
                autoComplete="off"
                spellCheck={false}
                value={email}
                onChange={(event) => { setEmail(event.target.value); setMessage(""); }}
                placeholder={t("managerAccess.emailPlaceholder")}
                aria-describedby="manager-account-email-help"
                className="w-full rounded-md border border-white/15 bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-gold focus:ring-1 focus:ring-gold"
            />
            <p id="manager-account-email-help" className="text-xs leading-5 text-foreground-muted">{t("managerAccess.emailHelp")}</p>
            <button type="submit" disabled={isPending || email.trim().length === 0} className={button}>{isPending && pendingAction === "grant" ? t("managerAccess.granting") : t("managerAccess.grant")}</button>
        </form>
        <p role="status" className={message ? "mt-3 max-w-xl text-sm leading-6 text-foreground-muted" : "sr-only"}>{message}</p>
    </section>;
}

/** Shows the current managers, or why there are none to show, with a Remove button for each website account. */
function ManagerList({ managers, disabled, removingId, onRemove }: {
    managers: readonly ServerManager[] | null; disabled: boolean; removingId: string | null;
    onRemove: (manager: ServerManager, label: string) => void;
}) {
    const { t } = useTranslations("managed-server");
    if (managers === null) return <p className="mt-2 text-sm leading-6 text-foreground-muted">{t("managerAccess.managersUnavailable")}</p>;
    if (managers.length === 0) return <p className="mt-2 text-sm leading-6 text-foreground-muted">{t("managerAccess.noManagers")}</p>;
    return <ul aria-labelledby={LIST_HEADING_ID} className="mt-2 divide-y divide-white/10 rounded-md border border-white/10">
        {managers.map(manager => {
            // Unresolved accounts keep a short ID so two of them can still be told apart.
            const label = manager.label ?? t("managerAccess.unknownAccount", { id: manager.accountId.slice(0, 8) });
            return <li key={manager.accountId} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 break-all text-sm">{label}</span>
                {manager.removable && <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onRemove(manager, label)}
                    aria-label={t("managerAccess.removeManager", { name: label })}
                    className={removeButton}
                >{removingId === manager.accountId ? t("managerAccess.removing") : t("managerAccess.remove")}</button>}
            </li>;
        })}
    </ul>;
}
