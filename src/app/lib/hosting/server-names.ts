export const MAX_SERVER_DISPLAY_NAME_LENGTH = 80;

export type ServerDisplayNameValidation =
    | { ok: true; displayName: string }
    | { ok: false; error: string };

export type ServerDisplayNameMessages = {
    required: string;
    singleLine: string;
    tooLong: string;
};

const defaultMessages: ServerDisplayNameMessages = {
    required: "Enter a server name.",
    singleLine: "Server names must use a single line of visible text.",
    tooLong: `Server names cannot exceed ${MAX_SERVER_DISPLAY_NAME_LENGTH} characters.`,
};

/** Validates and normalizes names while allowing callers to supply localized validation messages. */
export function validateServerDisplayName(value: unknown, messages: ServerDisplayNameMessages = defaultMessages): ServerDisplayNameValidation {
    if (typeof value !== "string") {
        return { ok: false, error: messages.required };
    }
    if (/[\u0000-\u001f\u007f]/u.test(value)) {
        return { ok: false, error: messages.singleLine };
    }

    const displayName = value.trim().replace(/ {2,}/gu, " ");
    if (!displayName) {
        return { ok: false, error: messages.required };
    }
    if (Array.from(displayName).length > MAX_SERVER_DISPLAY_NAME_LENGTH) {
        return { ok: false, error: messages.tooLong };
    }

    return { ok: true, displayName };
}
