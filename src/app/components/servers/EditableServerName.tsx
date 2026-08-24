"use client";

import { renameLiveServer } from "@/app/servers/name-actions";
import { Check, LoaderCircle, Pencil, X } from "lucide-react";
import { useState } from "react";
import { useFormStatus } from "react-dom";

function SaveButton() {
    const { pending } = useFormStatus();

    return (
        <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-sm border border-gold/40 bg-gold/10 px-4 font-label text-xs font-semibold uppercase tracking-[0.12em] text-gold transition-colors hover:bg-gold/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:cursor-not-allowed disabled:opacity-45"
        >
            {pending ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
                <Check aria-hidden="true" className="size-4" />
            )}
            Save
        </button>
    );
}

export function EditableServerName({
    canEdit,
    initialName,
    serverId,
}: {
    canEdit: boolean;
    initialName: string;
    serverId: string;
}) {
    const [displayName, setDisplayName] = useState(initialName);
    const [editing, setEditing] = useState(false);
    const [error, setError] = useState("");

    async function saveName(formData: FormData) {
        setError("");
        const result = await renameLiveServer(formData);
        if (!result.ok) {
            setError(result.error);
            return;
        }

        setDisplayName(result.displayName);
        setEditing(false);
    }

    return (
        <div className="mt-3">
            {editing ? (
                <h1 id="server-heading" className="sr-only">{displayName}</h1>
            ) : (
                <div className="flex min-w-0 items-center gap-3">
                    <h1 id="server-heading" className="min-w-0 break-words font-display text-4xl font-semibold text-foreground sm:text-5xl">
                        {displayName}
                    </h1>
                    {canEdit && (
                        <button
                            type="button"
                            onClick={() => {
                                setError("");
                                setEditing(true);
                            }}
                            aria-label={`Edit ${displayName} server name`}
                            title="Edit server name"
                            className="inline-flex size-10 shrink-0 items-center justify-center rounded-sm border border-white/15 bg-surface text-foreground-muted transition-colors hover:border-gold/40 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                        >
                            <Pencil aria-hidden="true" className="size-4" />
                        </button>
                    )}
                </div>
            )}

            {editing && (
                <form action={saveName} className="max-w-3xl">
                    <input type="hidden" name="serverId" value={serverId} />
                    <label htmlFor={`server-name-${serverId}`} className="sr-only">
                        Server name
                    </label>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <input
                            id={`server-name-${serverId}`}
                            name="displayName"
                            type="text"
                            required
                            autoFocus
                            maxLength={80}
                            defaultValue={displayName}
                            className="min-h-12 min-w-0 flex-1 rounded-sm border border-gold/40 bg-surface px-4 font-display text-2xl font-semibold text-foreground outline-none transition-colors hover:border-gold/60 focus:border-gold focus:ring-1 focus:ring-gold/30 sm:text-3xl"
                        />
                        <div className="flex shrink-0 gap-2">
                            <SaveButton />
                            <button
                                type="button"
                                onClick={() => {
                                    setError("");
                                    setEditing(false);
                                }}
                                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-sm border border-white/15 bg-background px-4 font-label text-xs font-semibold uppercase tracking-[0.12em] text-foreground-muted transition-colors hover:border-white/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                            >
                                <X aria-hidden="true" className="size-4" />
                                Cancel
                            </button>
                        </div>
                    </div>
                </form>
            )}

            {error && (
                <p role="alert" className="mt-3 text-sm text-red-300">
                    {error}
                </p>
            )}
        </div>
    );
}
