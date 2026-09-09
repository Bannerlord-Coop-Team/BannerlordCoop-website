// Build-only preload. Never import into application code. Blocks remote static-data fetches.
globalThis.fetch = async () => { throw new Error("Offline onboarding validation: outbound fetch blocked"); };
