import type { ReleaseBuild } from "@/app/lib/control-plane/types";

export function installableBuilds(builds: readonly ReleaseBuild[]) {
    return builds.filter((build) => build.validationState === "validated");
}

export function overviewStatRowClass(count: number) {
    if (count === 1) return "grid-cols-1";
    if (count === 2) return "grid-cols-1 sm:grid-cols-2";
    if (count === 3) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
    if (count === 4) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";
    throw new Error("Overview statistic rows must contain one through four cards.");
}
