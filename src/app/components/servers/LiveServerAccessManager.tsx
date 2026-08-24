"use client";

import {
    addLiveConsoleOperator,
    assignLiveConsoleOwner,
    clearLiveConsoleOwner,
    removeLiveConsoleOperator,
} from "@/app/servers/access-actions";
import type { LiveConsoleMember } from "@/app/lib/console/access";
import { LoaderCircle, UserCog, UserMinus, Users } from "lucide-react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

function SubmitButton({
    children,
    danger = false,
}: {
    children: ReactNode;
    danger?: boolean;
}) {
    const { pending } = useFormStatus();

    return (
        <button
            type="submit"
            disabled={pending}
            className={`inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-sm border px-3 font-label text-[0.62rem] font-semibold uppercase tracking-[0.11em] transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-45 ${
                danger
                    ? "border-red-500/35 bg-red-500/10 text-red-200 hover:bg-red-500/20 focus-visible:ring-red-400"
                    : "border-gold/40 bg-gold/10 text-gold hover:bg-gold/20 focus-visible:ring-gold"
            }`}
        >
            {pending && <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />}
            {children}
        </button>
    );
}

function AccountEmailField({ serverId, label }: { serverId: string; label: string }) {
    return (
        <>
            <input type="hidden" name="serverId" value={serverId} />
            <label htmlFor={`${label}-${serverId}`} className="sr-only">
                {label} account email
            </label>
            <input
                id={`${label}-${serverId}`}
                name="accountEmail"
                type="email"
                required
                maxLength={320}
                placeholder="member@example.com"
                autoComplete="off"
                className="min-h-9 min-w-0 flex-1 rounded-sm border border-white/15 bg-background px-3 text-xs text-foreground outline-none placeholder:text-foreground-dim hover:border-white/25 focus:border-gold focus:ring-1 focus:ring-gold/30"
            />
        </>
    );
}

export function LiveServerAccessManager({
    canAssignOwner,
    loadError,
    operators,
    owner,
    serverId,
    warning,
}: {
    canAssignOwner: boolean;
    loadError?: string;
    operators: readonly LiveConsoleMember[];
    owner: LiveConsoleMember | null;
    serverId: string;
    warning?: string;
}) {
    return (
        <div className="mt-5 grid gap-4 border-t border-white/10 pt-4 lg:grid-cols-2">
            <div className="rounded-sm border border-white/[0.08] bg-black/10 p-3.5">
                <div className="flex items-center gap-2">
                    <UserCog aria-hidden="true" className="size-4 text-gold-muted" />
                    <h3 className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-foreground-muted">
                        Owner account
                    </h3>
                </div>
                {warning && (
                    <p className="mt-3 text-xs leading-5 text-gold">{warning}</p>
                )}
                {loadError ? (
                    <p className="mt-3 text-xs leading-5 text-red-200">{loadError}</p>
                ) : owner ? (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{owner.displayName}</p>
                            <p className="mt-0.5 truncate text-xs text-foreground-dim">{owner.email}</p>
                        </div>
                        {canAssignOwner && (
                            <form
                                action={clearLiveConsoleOwner}
                                onSubmit={(event) => {
                                    if (!window.confirm("Remove this owner and every operator from the server?")) {
                                        event.preventDefault();
                                    }
                                }}
                            >
                                <input type="hidden" name="serverId" value={serverId} />
                                <SubmitButton danger>Remove owner</SubmitButton>
                            </form>
                        )}
                    </div>
                ) : (
                    <p className="mt-3 text-xs leading-5 text-foreground-dim">
                        No owner is assigned. Only administrators can manage this server.
                    </p>
                )}

                {canAssignOwner && !loadError && (
                    <>
                        <form action={assignLiveConsoleOwner} className="mt-3 flex flex-col gap-2 sm:flex-row">
                            <AccountEmailField serverId={serverId} label="owner" />
                            <SubmitButton>{owner ? "Reassign" : "Assign owner"}</SubmitButton>
                        </form>
                        {owner && (
                            <p className="mt-2 text-[0.68rem] leading-5 text-foreground-dim">
                                Transferring ownership removes all existing operators.
                            </p>
                        )}
                    </>
                )}
            </div>

            <div className="rounded-sm border border-white/[0.08] bg-black/10 p-3.5">
                <div className="flex items-center gap-2">
                    <Users aria-hidden="true" className="size-4 text-gold-muted" />
                    <h3 className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-foreground-muted">
                        Operators
                    </h3>
                </div>
                {loadError ? (
                    <p className="mt-3 text-xs leading-5 text-red-200">{loadError}</p>
                ) : operators.length > 0 ? (
                    <ul className="mt-3 grid gap-2">
                        {operators.map((operator) => (
                            <li key={operator.id} className="flex items-center justify-between gap-3 border border-white/[0.07] bg-background/50 px-3 py-2">
                                <div className="min-w-0">
                                    <p className="truncate text-xs font-medium text-foreground">{operator.displayName}</p>
                                    <p className="mt-0.5 truncate text-[0.68rem] text-foreground-dim">{operator.email}</p>
                                </div>
                                <form action={removeLiveConsoleOperator}>
                                    <input type="hidden" name="serverId" value={serverId} />
                                    <input type="hidden" name="operatorUserId" value={operator.id} />
                                    <button
                                        type="submit"
                                        title={`Remove ${operator.displayName}`}
                                        className="inline-flex size-8 items-center justify-center rounded-sm border border-red-500/30 bg-red-500/10 text-red-200 transition-colors hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                                    >
                                        <UserMinus aria-hidden="true" className="size-3.5" />
                                        <span className="sr-only">Remove {operator.displayName} as operator</span>
                                    </button>
                                </form>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="mt-3 text-xs leading-5 text-foreground-dim">
                        No operators are assigned.
                    </p>
                )}

                {!loadError && !warning && owner && (
                    <form action={addLiveConsoleOperator} className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <AccountEmailField serverId={serverId} label="operator" />
                        <SubmitButton>Add operator</SubmitButton>
                    </form>
                )}
            </div>
        </div>
    );
}
