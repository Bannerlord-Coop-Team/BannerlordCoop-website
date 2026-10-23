import { hasExactKeys, isRecord } from "../../../../supabase/functions/_shared/dto-validation";
import { isModId } from "../../../../supabase/functions/_shared/server-mods-contract";

export type ModLoadFailure = { modId: string; reason: "missing-assembly" | "load-error" | "missing-dll"; assembly?: string };
const ASSEMBLY_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/u;

/** Accepts only bounded identifiers and the runner's closed diagnosis shape. */
export function isModLoadFailure(value: unknown): value is ModLoadFailure {
    if (!isRecord(value) || !isModId(value.modId)) return false;
    if (value.reason === "missing-assembly") return hasExactKeys(value, ["modId", "reason", "assembly"]) && typeof value.assembly === "string" && ASSEMBLY_NAME.test(value.assembly);
    return (value.reason === "load-error" || value.reason === "missing-dll") && hasExactKeys(value, ["modId", "reason"]);
}
