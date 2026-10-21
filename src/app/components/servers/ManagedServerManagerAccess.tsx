"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "@/app/lib/localization/client";
import { removeServerManager, setServerManager } from "@/app/servers/server-manager-actions";
import type { ServerManager } from "@/app/lib/hosting/server-managers";

const button = "inline-flex min-h-10 items-center justify-center rounded-md border border-gold/50 bg-gold/10 px-4 py-2 text-sm font-semibold text-gold hover:bg-gold/15 focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40";
const removeButton = "inline-flex min-h-9 shrink-0 items-center justify-center rounded-md border border-crimson/50 px-3 py-1.5 text-sm font-semibold text-red-200 hover:border-crimson hover:bg-crimson/15 focus-visible:outline-2 focus-visible:outline-crimson disabled:cursor-not-allowed disabled:opacity-40";

/** Lets the owner list, grant and remove manager access; `managers` is null when the list could not be read. */
export function ManagedServerManagerAccess({ serverId, expectedUpdatedAt, canEdit, managers = null }: {
    serverId: string; expectedUpdatedAt: string; canEdit: boolean; managers?: readonly ServerManager[] | null;
}) {
    const { t } = useTranslations("managed-server");
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");
    const [removingId, setRemovingId] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    if (!canEdit) return null;

    // Submits the entered email as a new manager grant.
    function submit() {
        const form = new FormData();
        form.set("serverId", serverId);
        form.set("expectedUpdatedAt", expectedUpdatedAt);
        form.set("managerEmail", email);
        startTransition(async () => {
            const result = await setServerManager(form);
            setMessage(result.message);
            if (result.ok) setEmail("");
        });
    }

    // Revokes one listed manager; the refreshed page drops the row on success.
    function remove(accountId: string) {
        const form = new FormData();
        form.set("serverId", serverId);
        form.set("managerAccountId", accountId);
        setRemovingId(accountId);
        startTransition(async () => {
            const result = await removeServerManager(form);
            setMessage(result.message);
            setRemovingId(null);
        });
    }

    return <section aria-labelledby="managed-server-manager-heading" className="rounded-lg border border-white/10 bg-surface p-5 sm:p-6">
        <h2 id="managed-server-manager-heading" className="text-base font-semibold">{t("managerAccess.heading")}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-foreground-muted">{t("managerAccess.description")}</p>
        <div className="mt-5 max-w-xl">
            <h3 id="managed-server-manager-list-heading" className="text-sm font-medium">{t("managerAccess.currentManagers")}</h3>
            {managers === null
                ? <p className="mt-2 text-sm leading-6 text-foreground-muted">{t("managerAccess.managersUnavailable")}</p>
                : managers.length === 0
                    ? <p className="mt-2 text-sm leading-6 text-foreground-muted">{t("managerAccess.noManagers")}</p>
                    : <ul aria-labelledby="managed-server-manager-list-heading" className="mt-2 divide-y divide-white/10 rounded-md border border-white/10">
                        {managers.map(manager => {
                            const label = manager.label ?? t("managerAccess.unknownAccount");
                            return <li key={manager.accountId} className="flex items-center justify-between gap-3 px-3 py-2">
                                <span className="min-w-0 break-all text-sm">{label}</span>
                                {manager.removable && <button
                                    type="button"
                                    disabled={isPending}
                                    onClick={() => remove(manager.accountId)}
                                    aria-label={t("managerAccess.removeManager", { name: label })}
                                    className={removeButton}
                                >{removingId === manager.accountId ? t("managerAccess.removing") : t("managerAccess.remove")}</button>}
                            </li>;
                        })}
                    </ul>}
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
            <button type="submit" disabled={isPending || email.trim().length === 0} className={button}>{isPending && removingId === null ? t("managerAccess.granting") : t("managerAccess.grant")}</button>
        </form>
        {message && <p role="status" className="mt-3 max-w-xl text-sm leading-6 text-foreground-muted">{message}</p>}
    </section>;
}
