import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ServerResourceUsage } from "./ServerResourceUsage";

describe("per-server resource usage", () => {
    it("shows CPU in cores rather than host percentages, memory and observation time", () => {
        const html = renderToStaticMarkup(<ServerResourceUsage resources={{
            observedAt: "2026-09-06T05:15:00.000Z", sampleDurationMs: 250,
            cpuVcpus: 1.314, cpuLimitVcpus: 2,
            memoryUsedBytes: 1_610_612_736, memoryLimitBytes: 3_221_225_472,
        }} />);
        expect(html).toContain("1.31 / 2 vCPUs");
        expect(html).toContain("1.50 GiB / 3.00 GiB");
        expect(html).toContain("2026-09-06T05:15:00.000Z");
        expect(html).toContain("Includes game and controller overhead.");
    });

    it.each([null, undefined])("keeps missing and old-runner telemetry unavailable: %s", (resources) => {
        const html = renderToStaticMarkup(<ServerResourceUsage resources={resources} />);
        expect(html).toContain("CPU / memory unavailable");
        expect(html).not.toContain("0.00");
    });

    it("preserves a stopped slot's small controller baseline", () => {
        const html = renderToStaticMarkup(<ServerResourceUsage resources={{
            observedAt: "2026-09-06T05:15:00.000Z", sampleDurationMs: 250,
            cpuVcpus: 0.01, cpuLimitVcpus: 2,
            memoryUsedBytes: 104_857_600, memoryLimitBytes: 3_221_225_472,
        }} />);
        expect(html).toContain("0.01 / 2 vCPUs");
        expect(html).toContain("100.0 MiB");
    });
});
