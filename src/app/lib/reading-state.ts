/** What a reading hook shows: its result (if any), its last error, and whether its first read is still loading. */
export type ReadingView<T> = { result?: T; error?: string; pending: boolean };

/** A supplementary reading (billing, Oracle): its last result and error, never reset by a refreshed inventory. */
export type SupplementaryReading<T> = { result?: T; error?: string };

/** Shows the last supplementary result (a null result included), else `seed`; pending only before the first read settles. */
export function supplementaryView<T>(reading: SupplementaryReading<T> | undefined, seed: T | undefined, awaitingLiveData: boolean): ReadingView<T> {
    return {
        result: reading?.result !== undefined ? reading.result : seed,
        error: reading?.error,
        pending: reading === undefined && awaitingLiveData,
    };
}

/** Records a failed supplementary read, keeping its last result. */
export function failedSupplementaryReading<T>(previous: SupplementaryReading<T> | undefined, error: string): SupplementaryReading<T> {
    return { result: previous?.result, error };
}
