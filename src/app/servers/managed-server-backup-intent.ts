import {
    parseManagedServerBackupInput,
    type ManagedServerBackupInput,
} from "@/app/servers/managed-server-backup-input";

const MAX_STORED_INTENT_LENGTH = 1_024;
type IntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// Identity is supplied by the authenticated page, never sent as request authority.
export function managedServerBackupIntentKey(userId: string, serverId: string) {
    return `managed-server-backup-intent:v1:${encodeURIComponent(userId)}:${encodeURIComponent(serverId)}`;
}

export function readManagedServerBackupIntent(
    storage: IntentStorage,
    key: string,
    serverId: string,
): ManagedServerBackupInput | null {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    if (raw.length > MAX_STORED_INTENT_LENGTH) throw new Error("Invalid retained backup request");
    const intent = parseManagedServerBackupInput(JSON.parse(raw));
    if (intent === null || intent.serverId !== serverId) throw new Error("Invalid retained backup request");
    return intent;
}

export function storeManagedServerBackupIntent(
    storage: IntentStorage,
    key: string,
    intent: ManagedServerBackupInput,
) {
    const parsed = parseManagedServerBackupInput(intent);
    if (parsed === null) throw new Error("Invalid backup request");
    const current = readManagedServerBackupIntent(storage, key, intent.serverId);
    if (current !== null && JSON.stringify(current) !== JSON.stringify(parsed)) {
        throw new Error("Another backup request requires reconciliation");
    }
    storage.setItem(key, JSON.stringify(parsed));
}

export function clearManagedServerBackupIntent(
    storage: IntentStorage,
    key: string,
    resolved: ManagedServerBackupInput,
) {
    const current = readManagedServerBackupIntent(storage, key, resolved.serverId);
    // A late response from an unmounted component must not clear a newer intent.
    if (current?.requestId === resolved.requestId) storage.removeItem(key);
}

export function retainManagedServerBackupIntent(
    retained: ManagedServerBackupInput | null,
    candidate: ManagedServerBackupInput,
) {
    return retained ?? candidate;
}
