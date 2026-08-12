"use client";

import { updateMemberRole } from "@/app/admin/actions";
import { MEMBER_ROLES, type MemberRole } from "@/app/lib/auth/roles";
import { LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";

function SaveButton({ disabled }: { disabled: boolean }) {
    const { pending } = useFormStatus();

    return (
        <button
            type="submit"
            disabled={disabled || pending}
            className="inline-flex min-h-9 min-w-18 items-center justify-center rounded-sm border border-crimson bg-crimson px-3 font-label text-xs font-semibold uppercase tracking-[0.12em] text-white transition-colors hover:border-crimson-hover hover:bg-crimson-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson disabled:cursor-not-allowed disabled:opacity-45"
        >
            {pending ? (
                <LoaderCircle aria-label="Saving role" className="size-4 animate-spin" />
            ) : disabled ? (
                "Locked"
            ) : (
                "Save"
            )}
        </button>
    );
}

export function RoleEditor({
    currentRole,
    disabled,
    query,
    userId,
}: {
    currentRole: MemberRole;
    disabled: boolean;
    query: string;
    userId: string;
}) {
    return (
        <form action={updateMemberRole} className="flex items-center justify-end gap-2">
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="query" value={query} />
            <label htmlFor={`role-${userId}`} className="sr-only">
                Member role
            </label>
            <select
                id={`role-${userId}`}
                name="role"
                defaultValue={currentRole}
                disabled={disabled}
                className="min-h-9 rounded-sm border border-white/15 bg-background px-2.5 font-label text-xs font-semibold uppercase tracking-[0.08em] text-foreground outline-none transition-colors hover:border-white/25 focus:border-gold focus:ring-1 focus:ring-gold/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
                {MEMBER_ROLES.map((role) => (
                    <option key={role} value={role}>
                        {role}
                    </option>
                ))}
            </select>
            <SaveButton disabled={disabled} />
        </form>
    );
}
