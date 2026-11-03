// Mod builds before the empty-log fix describe an empty Coop_server.log as a
// zero-length gzip attachment instead of omitting it. The empty log carries no
// diagnostics, so the endpoint drops it rather than rejecting the whole report.

type SizedFile = { size: number };

/** Detects the zero-length server-log descriptor and part that older mod builds send for an empty log. */
export function isLegacyEmptyServerLog(
  descriptor: unknown,
  file: SizedFile | null,
): boolean {
  if (!descriptor || typeof descriptor !== "object") return false;
  const log = descriptor as {
    compressedLength?: unknown;
    uncompressedLength?: unknown;
  };
  if (log.compressedLength !== 0 || log.uncompressedLength !== 0) return false;
  return file === null || file.size === 0;
}
