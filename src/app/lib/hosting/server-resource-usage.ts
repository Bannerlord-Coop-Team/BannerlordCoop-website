/** Usage as fractions of the server's own allocation; the allocation itself is never sent to the page. */
export type ServerResourceUsage = { cpu: number; memory: number };

/**
 * Reduces a runner sample to shares of its allocation. CPU is measured against the slot's two-vCPU share and
 * exceeds 1 while the game bursts into idle host CPU; memory cannot pass its hard limit.
 */
export function serverResourceUsage(resources: { cpuVcpus: number; cpuLimitVcpus: number; memoryUsedBytes: number; memoryLimitBytes: number }): ServerResourceUsage {
    return {
        cpu: resources.cpuVcpus / resources.cpuLimitVcpus,
        memory: Math.min(1, resources.memoryUsedBytes / resources.memoryLimitBytes),
    };
}
