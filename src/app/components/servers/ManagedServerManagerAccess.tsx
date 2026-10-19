"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "@/app/lib/localization/client";
import { setServerManager } from "@/app/servers/server-manager-actions";

const button = "inline-flex min-h-10 items-center justify-center rounded-md border border-gold/50 bg-gold/10 px-4 py-2 text-sm font-semibold text-gold hover:bg-gold/15 focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40";

export function ManagedServerManagerAccess({ serverId, expectedUpdatedAt, canEdit }: { serverId: string; expectedUpdatedAt: string; canEdit: boolean }) {
    const { t } = useTranslations("managed-server");
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");
    const [isPending, startTransition] = useTransition();

    if (!canEdit) return null;

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

    return <section aria-labelledby="managed-server-manager-heading" className="rounded-lg border border-white/10 bg-surface p-5 sm:p-6">
        <h2 id="managed-server-manager-heading" className="text-base font-semibold">{t("managerAccess.heading")}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-foreground-muted">{t("managerAccess.description")}</p>
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
            <button type="submit" disabled={isPending || email.trim().length === 0} className={button}>{isPending ? t("managerAccess.granting") : t("managerAccess.grant")}</button>
            {message && <p role="status" className="text-sm leading-6 text-foreground-muted">{message}</p>}
        </form>
    </section>;
}
