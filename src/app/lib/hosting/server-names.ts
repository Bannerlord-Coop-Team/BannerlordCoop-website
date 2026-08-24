export const MAX_SERVER_DISPLAY_NAME_LENGTH = 80;

export type ServerDisplayNameValidation =
    | { ok: true; displayName: string }
    | { ok: false; error: string };

export function validateServerDisplayName(value: unknown): ServerDisplayNameValidation {
    if (typeof value !== "string") {
        return { ok: false, error: "Enter a server name." };
    }
    if (/[\u0000-\u001f\u007f]/u.test(value)) {
        return { ok: false, error: "Server names must use a single line of visible text." };
    }

    const displayName = value.trim().replace(/ {2,}/gu, " ");
    if (!displayName) {
        return { ok: false, error: "Enter a server name." };
    }
    if (Array.from(displayName).length > MAX_SERVER_DISPLAY_NAME_LENGTH) {
        return {
            ok: false,
            error: `Server names cannot exceed ${MAX_SERVER_DISPLAY_NAME_LENGTH} characters.`,
        };
    }

    return { ok: true, displayName };
}
