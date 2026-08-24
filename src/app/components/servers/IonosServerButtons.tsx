"use client";

import {
    getIonosServerPreset,
    IONOS_SERVER_PRESETS,
    isIonosServerPreset,
} from "@/app/lib/ionos/resources";
import {
    createIonosServer,
    destroyIonosServer,
} from "@/app/servers/actions";
import { ChevronDown, LoaderCircle, Plus, Trash2 } from "lucide-react";
import type { FormEvent } from "react";
import { useFormStatus } from "react-dom";

type CreateServerLocation = {
    id: string;
    name: string;
};

type CreateServerDefaults = {
    imageAlias: string;
    location: string;
};

function memoryLabel(ramMb: number) {
    return ramMb % 1024 === 0 ? `${ramMb / 1024} GB` : `${ramMb} MB`;
}

function CreateButton({ disabled }: { disabled: boolean }) {
    const { pending } = useFormStatus();

    return (
        <button
            type="submit"
            disabled={disabled || pending}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-sm border border-crimson bg-crimson px-5 font-label text-xs font-semibold uppercase tracking-[0.12em] text-white transition-colors hover:border-crimson-hover hover:bg-crimson-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson disabled:cursor-not-allowed disabled:opacity-45"
        >
            {pending ? (
                <LoaderCircle aria-label="Creating IONOS server" className="size-4 animate-spin" />
            ) : (
                <Plus aria-hidden="true" className="size-4" />
            )}
            {pending ? "Creating…" : "Confirm & create"}
        </button>
    );
}

export function CreateIonosServerForm({
    defaults,
    locations,
}: {
    defaults: CreateServerDefaults;
    locations: CreateServerLocation[];
}) {
    const defaultLocation = locations.some((location) => location.id === defaults.location)
        ? defaults.location
        : locations[0]?.id;

    function confirmCreate(event: FormEvent<HTMLFormElement>) {
        const formData = new FormData(event.currentTarget);
        const presetValue = String(formData.get("preset") ?? "");
        const locationId = String(formData.get("location") ?? "");
        const location = locations.find((candidate) => candidate.id === locationId);

        if (!isIonosServerPreset(presetValue)) {
            event.preventDefault();
            return;
        }

        const preset = getIonosServerPreset(presetValue);
        const summary = `${presetValue} (${preset.templateName}: ${preset.cores} vCPU, ${memoryLabel(preset.ramMb)}, ${preset.storageGb} GB NVMe, ${defaults.imageAlias}) in ${location?.name ?? locationId}`;

        if (
            !window.confirm(
                `Create this billable IONOS Cube?\n\n${summary}\n\nProvisioning starts immediately. Suspending a Cube does not stop billing.`,
            )
        ) {
            event.preventDefault();
        }
    }

    return (
        <details className="group mt-6 rounded-sm border border-white/10 bg-background/55">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-4 font-label text-xs font-semibold uppercase tracking-[0.14em] text-foreground transition-colors hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
                <span className="inline-flex items-center gap-2">
                    <Plus aria-hidden="true" className="size-4 text-gold" />
                    Create server
                </span>
                <ChevronDown aria-hidden="true" className="size-4 text-foreground-muted transition-transform group-open:rotate-180" />
            </summary>

            <form
                action={createIonosServer}
                onSubmit={confirmCreate}
                className="border-t border-white/10 p-4 sm:p-5"
            >
                <div className="grid gap-4 md:grid-cols-2">
                    <label className="block">
                        <span className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-foreground-muted">
                            Preset
                        </span>
                        <select
                            name="preset"
                            defaultValue="Standard"
                            className="mt-2 min-h-11 w-full rounded-sm border border-white/15 bg-surface px-3 text-sm text-foreground outline-none transition-colors hover:border-white/25 focus:border-gold focus:ring-1 focus:ring-gold/30"
                        >
                            {Object.entries(IONOS_SERVER_PRESETS).map(([name, preset]) => (
                                <option key={name} value={name}>
                                    {name} — {preset.cores} vCPU, {memoryLabel(preset.ramMb)}, {preset.storageGb} GB NVMe
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="block">
                        <span className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-foreground-muted">
                            Region
                        </span>
                        <select
                            name="location"
                            defaultValue={defaultLocation}
                            required
                            disabled={locations.length === 0}
                            className="mt-2 min-h-11 w-full rounded-sm border border-white/15 bg-surface px-3 text-sm text-foreground outline-none transition-colors hover:border-white/25 focus:border-gold focus:ring-1 focus:ring-gold/30 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                            {locations.map((location) => (
                                <option key={location.id} value={location.id}>
                                    {location.name} ({location.id})
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="block md:col-span-2">
                        <span className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-foreground-muted">
                            SSH public key
                        </span>
                        <textarea
                            name="sshPublicKey"
                            required
                            maxLength={8192}
                            rows={3}
                            spellCheck={false}
                            autoComplete="off"
                            placeholder="ssh-ed25519 AAAA... admin@example.com"
                            aria-describedby="ionos-ssh-key-help"
                            className="mt-2 w-full resize-y rounded-sm border border-white/15 bg-surface px-3 py-2.5 font-mono text-xs leading-5 text-foreground outline-none transition-colors placeholder:text-foreground-dim hover:border-white/25 focus:border-gold focus:ring-1 focus:ring-gold/30"
                        />
                        <span id="ionos-ssh-key-help" className="mt-1.5 block text-xs leading-5 text-foreground-dim">
                            Forwarded to IONOS for the new boot volume. Paste a public key only—never a private key.
                        </span>
                    </label>
                </div>

                <div className="mt-5 flex flex-col justify-between gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center">
                    <p className="text-xs leading-5 text-foreground-dim">
                        Compute, memory, and NVMe storage are fixed by the selected IONOS Cube template.
                    </p>
                    <CreateButton disabled={locations.length === 0} />
                </div>
            </form>
        </details>
    );
}

function DestroyButton({ serverName }: { serverName: string }) {
    const { pending } = useFormStatus();

    return (
        <button
            type="submit"
            disabled={pending}
            aria-label={`Destroy ${serverName}`}
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-sm border border-red-500/50 bg-red-500/10 px-4 font-label text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-red-200 transition-colors hover:border-red-400 hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:cursor-not-allowed disabled:opacity-45"
        >
            {pending ? (
                <LoaderCircle aria-label="Destroying IONOS server" className="size-4 animate-spin" />
            ) : (
                <Trash2 aria-hidden="true" className="size-4" />
            )}
            {pending ? "Destroying…" : "Destroy"}
        </button>
    );
}

export function DestroyIonosServerButton({
    datacenterId,
    serverId,
    serverName,
}: {
    datacenterId: string;
    serverId: string;
    serverName: string;
}) {
    function confirmDestroy(event: FormEvent<HTMLFormElement>) {
        if (
            !window.confirm(
                `Permanently destroy ${serverName} and its attached volumes in IONOS? This cannot be undone.`,
            )
        ) {
            event.preventDefault();
        }
    }

    return (
        <form action={destroyIonosServer} onSubmit={confirmDestroy}>
            <input type="hidden" name="datacenterId" value={datacenterId} />
            <input type="hidden" name="serverId" value={serverId} />
            <DestroyButton serverName={serverName} />
        </form>
    );
}
