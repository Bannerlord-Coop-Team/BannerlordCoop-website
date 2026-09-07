import type { HostingServerResources } from "@/app/lib/control-plane/types";

export function ServerResourceUsage({ resources }: { resources?: HostingServerResources | null }) {
    if (!resources) return <p className="mt-2 text-xs text-foreground-dim">CPU / memory unavailable</p>;
    return <dl className="mt-2 space-y-1 text-xs text-foreground-muted" aria-label="Server resource usage">
        <div className="flex flex-wrap gap-x-2"><dt>CPU</dt><dd>{resources.cpuVcpus.toFixed(2)} / {resources.cpuLimitVcpus.toFixed(0)} vCPUs</dd></div>
        <div className="flex flex-wrap gap-x-2"><dt>Memory</dt><dd>{memory(resources.memoryUsedBytes)} / {memory(resources.memoryLimitBytes)}</dd></div>
    </dl>;
}

function memory(bytes: number) {
    return bytes >= 1_073_741_824
        ? `${(bytes / 1_073_741_824).toFixed(2)} GiB`
        : `${(bytes / 1_048_576).toFixed(1)} MiB`;
}
