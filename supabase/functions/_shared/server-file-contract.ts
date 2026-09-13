import { parseManagedServerConfiguration, type ManagedServerConfiguration } from "./managed-server-configuration.ts";

export const MAXIMUM_WEB_SAVE_BYTES = 20 * 1_048_576;
export const MAXIMUM_WEB_CONFIG_BYTES = 64 * 1_024;
export const MAXIMUM_WEB_FILE_REQUEST_BYTES = 28 * 1_048_576;
export const MAXIMUM_WEB_FILE_RESPONSE_BYTES = 36 * 1_048_576;
export const WEB_FILE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type OwnerFileMutation = {
  serverId: string;
  expectedUpdatedAt: string;
} & (
  | { action: 'import-config'; managedConfig: ManagedServerConfiguration }
  | { action: 'export-save'; saveId: string }
  | { action: 'import-save'; displayName: string; files: { basename: string; base64: string }[] }
);

export interface OwnerFileStatus {
  serverId: string;
  updatedAt: string;
  operationState: string;
  observedGameState: string;
  activeSave: { saveId: string; displayName: string } | null;
  managedConfig: ManagedServerConfiguration;
}

export type OwnerFileResult =
  | { kind: 'rejected' }
  | { kind: 'configuration'; outcome: 'updated' | 'existing'; updatedAt: string }
  | { kind: 'job'; outcome: 'enqueued' | 'existing'; jobId: string; action: 'import-save' | 'export-save'; state: string };

export type OwnerFileDownload =
  | { kind: 'file'; fileName: string; base64: string; byteSize: number }
  | { kind: 'link'; url: string; expiresAt: string; byteSize: number };

export function parseOwnerFileMutation(value: unknown): OwnerFileMutation {
  if (!record(value) || typeof value.action !== 'string') throw new Error('Invalid file operation');
  requireUuid(value.serverId);
  requireFileTimestamp(value.expectedUpdatedAt);
  const common = ['action', 'serverId', 'expectedUpdatedAt'];
  if (value.action === 'import-config') {
    exact(value, [...common, 'managedConfig']);
    return { ...value, managedConfig: parseManagedServerConfiguration(value.managedConfig) } as OwnerFileMutation;
  }
  if (value.action === 'export-save') {
    exact(value, [...common, 'saveId']);
    requireUuid(value.saveId);
    return value as OwnerFileMutation;
  }
  if (value.action !== 'import-save') throw new Error('Invalid file operation');
  exact(value, [...common, 'displayName', 'files']);
  if (typeof value.displayName !== 'string' || value.displayName.trim() !== value.displayName
    || value.displayName.length < 3 || value.displayName.length > 48 || /[\p{Cc}\p{Cf}]/u.test(value.displayName)) {
    throw new Error('Use a campaign name between 3 and 48 characters');
  }
  if (!Array.isArray(value.files) || ![1, 2].includes(value.files.length)) throw new Error('Select a .blcexport or one .sav and its matching .json companion');
  let total = 0;
  for (const file of value.files) {
    if (!record(file)) throw new Error('Invalid save file');
    exact(file, ['basename', 'base64']);
    if (typeof file.basename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,118}\.(?:sav|json|blcexport)$/u.test(file.basename)
      || file.basename.includes('..')) throw new Error('Invalid save filename');
    if (typeof file.base64 !== 'string' || file.base64.length === 0
      || file.base64.length > Math.ceil(MAXIMUM_WEB_SAVE_BYTES / 3) * 4
      || file.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(file.base64)) {
      throw new Error('Invalid save contents');
    }
    total += file.base64.length / 4 * 3 - (file.base64.endsWith('==') ? 2 : file.base64.endsWith('=') ? 1 : 0);
  }
  if (total > MAXIMUM_WEB_SAVE_BYTES) throw new Error('Save and companion must total 20 MiB or less');
  const files = value.files as { basename: string; base64: string }[];
  if (files.length === 1 && files[0]?.basename.endsWith('.blcexport')) return value as OwnerFileMutation;
  const save = files.find((file) => file.basename.endsWith('.sav'));
  if (save === undefined || !files.some((file) => file.basename === save.basename.slice(0, -4) + '.json')) {
    throw new Error('The .sav and .json filenames must match');
  }
  return value as OwnerFileMutation;
}

export function requireUuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !WEB_FILE_UUID.test(value)) throw new Error('Invalid file request ID');
}

export function requireFileTimestamp(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Invalid file request timestamp');
}

export function parseOwnerFileStatus(value: unknown): OwnerFileStatus {
  if (!record(value)) throw new Error('Invalid file status');
  exact(value, ['serverId', 'updatedAt', 'operationState', 'observedGameState', 'activeSave', 'managedConfig']);
  requireUuid(value.serverId);
  requireFileTimestamp(value.updatedAt);
  for (const key of ['operationState', 'observedGameState']) {
    if (typeof value[key] !== 'string' || !/^[a-z][a-z-]{0,63}$/u.test(value[key])) throw new Error('Invalid file status');
  }
  if (value.activeSave !== null) {
    if (!record(value.activeSave)) throw new Error('Invalid campaign');
    exact(value.activeSave, ['saveId', 'displayName']);
    requireUuid(value.activeSave.saveId);
    if (typeof value.activeSave.displayName !== 'string' || value.activeSave.displayName.length < 1
      || value.activeSave.displayName.length > 128 || /[\p{Cc}\p{Cf}]/u.test(value.activeSave.displayName)) throw new Error('Invalid campaign');
  }
  return { ...value, managedConfig: parseManagedServerConfiguration(value.managedConfig) } as OwnerFileStatus;
}

export function parseOwnerFileResult(value: unknown): OwnerFileResult | null {
  if (value === null) return null;
  if (!record(value)) throw new Error('Invalid transfer result');
  if (value.kind === 'rejected') {
    exact(value, ['kind']);
  } else if (value.kind === 'configuration') {
    exact(value, ['kind', 'outcome', 'updatedAt']);
    requireFileTimestamp(value.updatedAt);
    if (value.outcome !== 'updated' && value.outcome !== 'existing') throw new Error('Invalid transfer outcome');
  } else {
    exact(value, ['kind', 'outcome', 'jobId', 'action', 'state']);
    requireUuid(value.jobId);
    if (value.kind !== 'job' || !['enqueued', 'existing'].includes(String(value.outcome))
      || !['import-save', 'export-save'].includes(String(value.action))
      || !['queued', 'running', 'retry-wait', 'succeeded', 'failed', 'cancelled'].includes(String(value.state))) throw new Error('Invalid transfer job');
  }
  return value as OwnerFileResult;
}

export function parseOwnerFileDownload(value: unknown): OwnerFileDownload {
  if (!record(value) || !Number.isSafeInteger(value.byteSize) || (value.byteSize as number) < 1
    || (value.byteSize as number) > 512 * 1_048_576) throw new Error('Invalid download size');
  if (value.kind === 'file') {
    exact(value, ['kind', 'fileName', 'base64', 'byteSize']);
    if (typeof value.fileName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(value.fileName)
      || value.fileName.includes('..') || typeof value.base64 !== 'string' || value.base64.length % 4 !== 0
      || value.base64.length > Math.ceil(25 * 1_048_576 / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value.base64)
      || value.base64.length / 4 * 3 - (value.base64.endsWith('==') ? 2 : value.base64.endsWith('=') ? 1 : 0) !== value.byteSize) {
      throw new Error('Invalid download file');
    }
  } else if (value.kind === 'link') {
    exact(value, ['kind', 'url', 'expiresAt', 'byteSize']);
    requireFileTimestamp(value.expiresAt);
    if (typeof value.url !== 'string' || value.url.length > 1_024) throw new Error('Invalid download link');
    const url = new URL(value.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !(url.pathname === '/managed-hosting/v1/owner-export' && url.search === '' && url.hash.length > 1
        || /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/u.test(url.hostname)
          && /^\/[a-z0-9-]+\/managed-hosting\/owner-exports\/v1\//u.test(url.pathname) && url.hash === '')) {
      throw new Error('Invalid download destination');
    }
  } else throw new Error('Invalid download');
  return value as OwnerFileDownload;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new Error('Invalid file request fields');
}
