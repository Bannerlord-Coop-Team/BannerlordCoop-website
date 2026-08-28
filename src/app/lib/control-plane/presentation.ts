import type { ReleaseBuild } from "@/app/lib/control-plane/types";

export function installableBuilds(builds: readonly ReleaseBuild[]) {
    return builds.filter((build) => build.validationState === "validated");
}
