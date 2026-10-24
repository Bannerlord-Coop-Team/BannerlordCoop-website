"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "@/app/lib/localization/client";
import { removeServerManager, setServerManager } from "@/app/servers/server-manager-actions";
import type { ServerManager } from "@/app/lib/hosting/server-managers";
import { Users } from "lucide-react";
import { fileDangerButtonClass, filePrimaryButtonClass } from "./server-file-styles";
import { WorkspaceCard, workspaceListClass } from "./server-workspace-ui";

const removeButton = `${fileDangerButtonClass} shrink-0`;
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
    const emailInput = useRef<HTMLInputElement>(null);

    if (!canEdit) return null;

    // Calls one manager action, turning a failed call (network loss, a redeployed action) into the generic retry message.
    async function attempt(action: typeof setServerManager, form: FormData) {
        try { return await action(form); }
        catch { return { ok: false, message: t("managerAccess.requestCouldNotBeConfirmed") }; }
    }

    // Submits the entered email as a new manager grant; focus returns to the email field, since the button was disabled.
    function submit() {
        const form = new FormData();
        form.set("serverId", serverId);
        form.set("expectedUpdatedAt", expectedUpdatedAt);
        form.set("managerEmail", email);
        setMessage("");
        setPendingAction("grant");
        startTransition(async () => {
            const result = await attempt(setServerManager, form);
            setMessage(result.message);
            if (result.ok) setEmail("");
            emailInput.current?.focus();
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
            const result = await attempt(removeServerManager, form);
            setMessage(result.message);
            listHeading.current?.focus();
        });
    }

    return <WorkspaceCard headingId="managed-server-manager-heading" title={t("managerAccess.heading")} icon={Users}>
        <div className="max-w-xl">
            <h3 ref={listHeading} id={LIST_HEADING_ID} tabIndex={-1} className="text-sm font-medium outline-none">{t("managerAccess.currentManagers")}</h3>
            <ManagerList managers={managers} disabled={isPending} removingId={isPending ? pendingAction : null} onRemove={remove} />
        </div>
        <form className="mt-5 max-w-xl" onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <label htmlFor="manager-account-email" className="block text-sm font-medium">{t("managerAccess.emailLabel")}</label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
                ref={emailInput}
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
                className="min-h-10 w-full min-w-0 flex-1 rounded-md border border-white/15 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold focus:ring-1 focus:ring-gold"
            />
            <button type="submit" disabled={isPending || email.trim().length === 0} className={`${filePrimaryButtonClass} shrink-0`}>{isPending && pendingAction === "grant" ? t("managerAccess.granting") : t("managerAccess.grant")}</button>
            </div>
            <p id="manager-account-email-help" className="mt-2 text-xs leading-5 text-foreground-muted">{t("managerAccess.emailHelp")}</p>
        </form>
        <p role="status" className={message ? "mt-3 max-w-xl text-sm leading-6 text-foreground-muted" : "sr-only"}>{message}</p>
    </WorkspaceCard>;
}

/** Shows the current managers, or why there are none to show, with a Remove button for each website account. */
function ManagerList({ managers, disabled, removingId, onRemove }: {
    managers: readonly ServerManager[] | null; disabled: boolean; removingId: string | null;
    onRemove: (manager: ServerManager, label: string) => void;
}) {
    const { t } = useTranslations("managed-server");
    if (managers === null) return <p className="mt-2 text-sm leading-6 text-foreground-muted">{t("managerAccess.managersUnavailable")}</p>;
    if (managers.length === 0) return <p className="mt-2 text-sm leading-6 text-foreground-muted">{t("managerAccess.noManagers")}</p>;
    return <ul aria-labelledby={LIST_HEADING_ID} className={`mt-2 ${workspaceListClass}`}>
        {managers.map(manager => {
            // Unresolved accounts keep a short ID so two of them can still be told apart.
            const label = manager.label ?? t("managerAccess.unknownAccount", { id: manager.accountId.slice(0, 8) });
            return <li key={manager.accountId} className="flex items-center justify-between gap-3 px-4 py-2.5">
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
