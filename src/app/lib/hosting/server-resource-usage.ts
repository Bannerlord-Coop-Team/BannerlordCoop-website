/** Usage as fractions (0 to 1) of the server's own allocation; the allocation itself is never sent to the page. */
export type ServerResourceUsage = { cpu: number; memory: number };

/** Reduces a runner sample to shares of its allocation; the cgroup quota keeps CPU at or below its limit. */
export function serverResourceUsage(resources: { cpuVcpus: number; cpuLimitVcpus: number; memoryUsedBytes: number; memoryLimitBytes: number }): ServerResourceUsage {
    return {
        cpu: Math.min(1, resources.cpuVcpus / resources.cpuLimitVcpus),
        memory: Math.min(1, resources.memoryUsedBytes / resources.memoryLimitBytes),
    };
}
