"use client";

import { LoaderCircle, Play, TriangleAlert } from "lucide-react";
import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type AdminActionOption = {
    label: string;
    value: string;
    updatedAt?: string;
};

export type AdminActionField = {
    name: string;
    label: string;
    kind?: "text" | "textarea" | "number" | "checkbox" | "select" | "server" | "job" | "password";
    placeholder?: string;
    required?: boolean;
    minimum?: number;
    maximum?: number;
    defaultValue?: string | number | boolean;
    options?: AdminActionOption[];
    valueType?: "string" | "number" | "boolean" | "csv" | "nullable";
};

export function ControlPlaneActionCard({
    operation,
    title,
    description,
    fields,
    destructive = false,
}: {
    operation: string;
    title: string;
    description: string;
    fields: AdminActionField[];
    destructive?: boolean;
}) {
    const router = useRouter();
    const [pending, setPending] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

    async function submit(formData: FormData) {
        if (destructive && !window.confirm(`Run “${title}”? The control plane will enforce its current-state and confirmation gates.`)) {
            return;
        }
        setPending(true);
        setResult(null);
        const requestId = crypto.randomUUID();
        try {
            const input = buildInput(fields, formData);
            normalizeOperationInput(operation, input);
            const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
            if (!session?.access_token) throw new Error("Authentication is required.");
            const response = await requestControlPlaneAdmin({
                accessToken: session.access_token,
                requestId,
                operation,
                ...(fields.length === 0 ? {} : { input }),
            });
            setResult({ ok: true, message: summarizeResult(response) });
            router.refresh();
        } catch (error) {
            setResult({ ok: false, message: error instanceof Error ? error.message : "The operation failed." });
        } finally {
            setPending(false);
        }
    }

    return (
        <article className="border border-white/10 bg-surface p-5">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="font-display text-xl font-semibold text-foreground">{title}</h3>
                    <p className="mt-1 text-xs leading-5 text-foreground-muted">{description}</p>
                </div>
                {destructive && <TriangleAlert aria-label="Destructive operation" className="size-4 shrink-0 text-red-300" />}
            </div>
            <form action={submit} className="mt-4 grid gap-3">
                {fields.map((field) => <ActionField key={field.name} field={field} />)}
                <button
                    type="submit"
                    disabled={pending}
                    className="mt-1 inline-flex min-h-10 items-center justify-center gap-2 border border-crimson bg-crimson px-4 font-label text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-white transition-colors hover:bg-crimson-hover disabled:cursor-wait disabled:opacity-60"
                >
                    {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Play aria-hidden="true" className="size-3.5" />}
                    {pending ? "Working" : "Run"}
                </button>
            </form>
            {result && (
                <p
                    role={result.ok ? "status" : "alert"}
                    className={`mt-4 max-h-80 overflow-auto whitespace-pre-wrap break-words border-l-2 px-3 py-2 font-mono text-xs leading-5 ${result.ok ? "border-emerald-500 bg-emerald-500/10 text-emerald-200" : "border-crimson bg-crimson/10 text-red-200"}`}
                >
                    {result.message}
                </p>
            )}
        </article>
    );
}

function ActionField({ field }: { field: AdminActionField }) {
    if (field.kind === "checkbox") {
        return (
            <label className="flex items-center gap-3 text-xs text-foreground-muted">
                <input
                    type="checkbox"
                    name={field.name}
                    defaultChecked={field.defaultValue === true}
                    className="size-4 accent-crimson"
                />
                {field.label}
            </label>
        );
    }
    const label = <span className="font-label text-[0.6rem] font-semibold uppercase tracking-[0.13em] text-foreground-muted">{field.label}</span>;
    const className = "mt-1.5 min-h-10 w-full border border-white/15 bg-background px-3 text-xs text-foreground outline-none placeholder:text-foreground-dim focus:border-gold";
    if (field.kind === "textarea") {
        return <label>{label}<textarea name={field.name} required={field.required} placeholder={field.placeholder} defaultValue={String(field.defaultValue ?? "")} rows={3} className={`${className} py-2`} /></label>;
    }
    if (["select", "server", "job"].includes(field.kind ?? "")) {
        return (
            <label>
                {label}
                <select name={field.name} required={field.required} defaultValue={String(field.defaultValue ?? "")} className={className}>
                    {!field.required && <option value="">None</option>}
                    {field.options?.map((option) => (
                        <option
                            key={`${option.value}:${option.updatedAt ?? ""}`}
                            value={field.kind === "server" || field.kind === "job"
                                ? JSON.stringify({ id: option.value, updatedAt: option.updatedAt })
                                : option.value}
                        >
                            {option.label}
                        </option>
                    ))}
                </select>
            </label>
        );
    }
    return (
        <label>
            {label}
            <input
                name={field.name}
                type={field.kind === "number" ? "number" : field.kind === "password" ? "password" : "text"}
                required={field.required}
                min={field.minimum}
                max={field.maximum}
                placeholder={field.placeholder}
                defaultValue={typeof field.defaultValue === "boolean" ? undefined : field.defaultValue}
                className={className}
                autoComplete={field.kind === "password" ? "new-password" : undefined}
            />
        </label>
    );
}

function buildInput(fields: AdminActionField[], formData: FormData) {
    const input: Record<string, unknown> = {};
    for (const field of fields) {
        if (field.kind === "server" || field.kind === "job") {
            const raw = String(formData.get(field.name) ?? "");
            if (!raw) continue;
            const selected = JSON.parse(raw) as { id: string; updatedAt?: string };
            setPath(input, field.name, selected.id);
            if (selected.updatedAt) setPath(input, "expectedUpdatedAt", selected.updatedAt);
            continue;
        }
        const raw = formData.get(field.name);
        if (field.kind === "checkbox" || field.valueType === "boolean") {
            setPath(input, field.name, raw === "on");
            continue;
        }
        const text = String(raw ?? "").trim();
        if (!text && !field.required) {
            if (field.valueType === "nullable") setPath(input, field.name, null);
            continue;
        }
        if (field.valueType === "number" || field.kind === "number") setPath(input, field.name, Number(text));
        else if (field.valueType === "csv") setPath(input, field.name, text ? text.split(",").map((value) => value.trim()).filter(Boolean) : []);
        else if (field.valueType === "nullable") setPath(input, field.name, text || null);
        else setPath(input, field.name, text);
    }
    return input;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
    const parts = path.split(".");
    let current = target;
    for (const part of parts.slice(0, -1)) {
        const existing = current[part];
        if (typeof existing !== "object" || existing === null || Array.isArray(existing)) current[part] = {};
        current = current[part] as Record<string, unknown>;
    }
    current[parts.at(-1)!] = value;
}

function normalizeOperationInput(operation: string, input: Record<string, unknown>) {
    if (operation === "reset-password") {
        const choice = input.choice as Record<string, unknown> | undefined;
        if (choice?.kind === "generated") delete choice.password;
    }
    if (operation === "replace-provider") {
        const selection = input.selection as Record<string, unknown> | undefined;
        if (selection?.action === "resize") {
            delete selection.targetImageId;
            delete selection.targetFriendlyRegion;
        } else if (selection?.action === "rebuild") {
            delete selection.targetSizeId;
            delete selection.targetFriendlyRegion;
        } else if (selection?.action === "migrate-region") {
            delete selection.targetSizeId;
            delete selection.targetImageId;
        }
    }
}

function summarizeResult(result: unknown) {
    if (typeof result !== "object" || result === null) return "Operation completed.";
    const record = result as Record<string, unknown>;
    if (typeof record.generatedPassword === "string") {
        return `Operation completed. Generated password: ${record.generatedPassword} (copy it now; it is not shown again).`;
    }
    const job = record.job;
    if (typeof job === "object" && job !== null && typeof (job as Record<string, unknown>).jobId === "string") {
        return `Operation accepted. Job ${(job as Record<string, unknown>).jobId as string}.`;
    }
    if (typeof record.reviewId === "string" || Object.hasOwn(record, "snapshot")) {
        return JSON.stringify(result, null, 2).slice(0, 12_000);
    }
    return "Operation completed and the dashboard has been refreshed.";
}
