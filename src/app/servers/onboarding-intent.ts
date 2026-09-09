import { parseOnboardingIntent, type OnboardingIntent } from "../../../supabase/functions/_shared/server-onboarding-contract";

type IntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function onboardingIntentKey(userId: string) { return `server-onboarding-intent:v1:${encodeURIComponent(userId)}`; }
export function readOnboardingIntent(storage: IntentStorage, key: string): OnboardingIntent | null {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    if (raw.length > 1024) throw new Error("Invalid retained onboarding request");
    return parseOnboardingIntent(JSON.parse(raw));
}
export function storeOnboardingIntent(storage: IntentStorage, key: string, intent: OnboardingIntent) {
    const parsed = parseOnboardingIntent(intent);
    const current = readOnboardingIntent(storage, key);
    if (current !== null && JSON.stringify(current) !== JSON.stringify(parsed)) throw new Error("Reconcile the pending request first");
    storage.setItem(key, JSON.stringify(parsed));
    if (JSON.stringify(readOnboardingIntent(storage, key)) !== JSON.stringify(parsed)) throw new Error("Request storage is unavailable");
}
export function clearOnboardingIntent(storage: IntentStorage, key: string, resolved: OnboardingIntent) {
    const current = readOnboardingIntent(storage, key);
    // Compare the entire normalized intent so a late response cannot erase a newer one.
    if (current !== null && JSON.stringify(current) === JSON.stringify(parseOnboardingIntent(resolved))) storage.removeItem(key);
}
