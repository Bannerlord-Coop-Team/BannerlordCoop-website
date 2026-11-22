import rawCatalog from './managed-config-catalog-generated.ts';

type CatalogOption = { key: string; type: string; default: unknown; min?: number; max?: number;
  itemPattern?: string; itemFormat?: 'steamId64'; uniqueItems?: boolean;
  availableSince: string; values?: readonly string[]; coerceRanges?: readonly (readonly [number, number, number])[] };
type Catalog = { contentDigest: string; options: readonly CatalogOption[] };
const catalog: Catalog = rawCatalog;
const STEAM_ID_64 = /^[0-9]{17}$/u;
const CATALOG_MAX_OPTIONS = 128;
const CATALOG_MAX_KEY_LENGTH = 64;
const CATALOG_MAX_STRING_LENGTH = 128;
const CATALOG_MAX_ENUM_VALUES = 32;
const CATALOG_MAX_RULES = 8;
const MANAGED_LIST_MAX_ITEMS = 32;
const CATALOG_MAX_NUMERIC_BOUND = 1_000_000_000;

function catalogEnumValues<const T extends readonly string[]>(key: string): T {
  const option = catalog.options.find(candidate => candidate.key === key);
  if (option?.type !== 'enum' || option.values === undefined) throw new Error(`Managed configuration enum is missing: ${key}`);
  return option.values as T;
}

function managedConfigListItemMatches(option: CatalogOption, entry: string): boolean {
  return (option.itemFormat !== 'steamId64' || STEAM_ID_64.test(entry))
    && (option.itemPattern === undefined || new RegExp(option.itemPattern, 'u').test(entry));
}

export function validateManagedConfigCatalog(value: unknown): asserts value is Catalog {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Managed configuration catalog is malformed');
  const candidate = value as Catalog;
  if (Object.keys(candidate).length !== 2 || typeof candidate.contentDigest !== 'string'
    || !/^[0-9a-f]{64}$/u.test(candidate.contentDigest)
    || !Array.isArray(candidate.options) || candidate.options.length === 0 || candidate.options.length > CATALOG_MAX_OPTIONS) throw new Error('Managed configuration catalog is malformed');
  const keys = new Set<string>();
  for (const option of candidate.options) {
    if (typeof option !== 'object' || option === null || Array.isArray(option)
      || typeof option.key !== 'string' || option.key.length > CATALOG_MAX_KEY_LENGTH || !/^[a-z][A-Za-z0-9]*$/u.test(option.key) || keys.has(option.key)
      || !['boolean', 'integer', 'number', 'enum', 'stringList'].includes(option.type)
      || typeof option.availableSince !== 'string' || !/^\d+\.\d+\.\d+$/u.test(option.availableSince)
      || option.default === undefined) throw new Error(`Managed configuration catalog option is malformed: ${option.key}`);
    keys.add(option.key);
    if (option.type === 'boolean' && typeof option.default !== 'boolean') throw new Error(`Managed configuration catalog default is malformed: ${option.key}`);
    if (option.type === 'integer' && !Number.isSafeInteger(option.default)) throw new Error(`Managed configuration catalog default is malformed: ${option.key}`);
    if (option.type === 'number' && (typeof option.default !== 'number' || !Number.isFinite(option.default))) throw new Error(`Managed configuration catalog default is malformed: ${option.key}`);
    if (option.type === 'enum' && (!Array.isArray(option.values) || option.values.length === 0 || option.values.length > CATALOG_MAX_ENUM_VALUES
      || option.values.some((candidate: unknown) => typeof candidate !== 'string' || candidate.length === 0 || candidate.length > CATALOG_MAX_STRING_LENGTH)
      || new Set(option.values).size !== option.values.length || !option.values.includes(String(option.default)))) throw new Error(`Managed configuration catalog enum is malformed: ${option.key}`);
    if (option.type !== 'enum' && option.values !== undefined) throw new Error(`Managed configuration catalog enum is malformed: ${option.key}`);
    if (option.min !== undefined && (typeof option.min !== 'number' || !Number.isFinite(option.min) || Math.abs(option.min) > CATALOG_MAX_NUMERIC_BOUND || option.type === 'integer' && !Number.isSafeInteger(option.min))) throw new Error(`Managed configuration catalog bounds are malformed: ${option.key}`);
    if (option.max !== undefined && (typeof option.max !== 'number' || !Number.isFinite(option.max) || Math.abs(option.max) > CATALOG_MAX_NUMERIC_BOUND || option.type === 'integer' && !Number.isSafeInteger(option.max))) throw new Error(`Managed configuration catalog bounds are malformed: ${option.key}`);
    if (option.min !== undefined && option.max !== undefined && option.min > option.max) throw new Error(`Managed configuration catalog bounds are malformed: ${option.key}`);
    if ((option.itemPattern !== undefined || option.itemFormat !== undefined || option.uniqueItems !== undefined) && option.type !== 'stringList'
      || option.itemFormat !== undefined && option.itemFormat !== 'steamId64'
      || option.uniqueItems !== undefined && typeof option.uniqueItems !== 'boolean') throw new Error(`Managed configuration catalog list rules are malformed: ${option.key}`);
    if (option.itemPattern !== undefined) {
      if (typeof option.itemPattern !== 'string' || option.itemPattern.length === 0 || option.itemPattern.length > CATALOG_MAX_STRING_LENGTH) throw new Error(`Managed configuration catalog pattern is malformed: ${option.key}`);
      try { new RegExp(option.itemPattern, 'u'); } catch { throw new Error(`Managed configuration catalog pattern is malformed: ${option.key}`); }
    }
    if (option.coerceRanges !== undefined && ((option.type !== 'integer' && option.type !== 'number') || !Array.isArray(option.coerceRanges) || option.coerceRanges.length > CATALOG_MAX_RULES || option.coerceRanges.some((range: unknown) => !Array.isArray(range) || range.length !== 3 || range.some(part => typeof part !== 'number' || !Number.isFinite(part)) || !Number.isSafeInteger(range[0]) || !Number.isSafeInteger(range[1]) || range[0] > range[1]))) throw new Error(`Managed configuration catalog coercion rules are malformed: ${option.key}`);
    if (option.type === 'stringList') {
      const list = option.default;
      if (!Array.isArray(list) || list.some((entry) => typeof entry !== 'string' || !managedConfigListItemMatches(option, entry))
        || option.uniqueItems === true && new Set(list).size !== list.length) throw new Error(`Managed configuration catalog list default is malformed: ${option.key}`);
    }
    if (option.min !== undefined && (option.default as number) < option.min || option.max !== undefined && (option.default as number) > option.max) throw new Error(`Managed configuration catalog bounds are malformed: ${option.key}`);
  }

}

validateManagedConfigCatalog(catalog);
export const MANAGED_CONFIG_CATALOG_OPTIONS = catalog.options;

// Mirror the direct parser at ControlPlane 8e5c511d while that runner is supported.
const RELEASED_NUMERIC_BOUNDS: Readonly<Record<string, readonly [number, number] | undefined>> = Object.freeze({
  battleSize: [200, 1000],
  playerBattleAiJoinWindowHours: [0, 8760],
  wandererLimit: [0, 1000],
  playerKingdomClanTierRequired: [0, 6],
  smithingStaminaRecoveryMultiplier: [0, 100],
  maximumLootersMultiplier: [0, 100],
  looterPartySizeMultiplier: [0, 100],
});

export function managedConfigNumericBounds(option: CatalogOption, battleSizeLimit: number) {
  const released = Object.hasOwn(RELEASED_NUMERIC_BOUNDS, option.key) ? RELEASED_NUMERIC_BOUNDS[option.key] : undefined;
  return {
    min: released === undefined ? option.min : Math.max(option.min ?? released[0], released[0]),
    // The editor receives the actual Limitless limit. Reads must also decode values within that expanded range.
    max: option.key === 'battleSize' ? battleSizeLimit
      : released === undefined ? option.max : Math.min(option.max ?? released[1], released[1]),
  };
}


export const MANAGED_DIFFICULTY_LEVELS = ['VeryEasy', 'Easy', 'Realistic'] as const;
export type ManagedDifficultyLevel = (typeof MANAGED_DIFFICULTY_LEVELS)[number];

export const MANAGED_GOLD_FOOD_CHANGE_MODES = catalogEnumValues<readonly ['Disabled', 'OneDayMax', 'Enabled']>('goldFoodInfluenceChangeInBattles');
export type ManagedGoldFoodChangeMode = (typeof MANAGED_GOLD_FOOD_CHANGE_MODES)[number];

export const MANAGED_LORD_DEFECTION_RETRY_MODES = catalogEnumValues<readonly ['Vanilla', 'NeverExpire', 'AlwaysRetry']>('lordDefectionRetries');
export type ManagedLordDefectionRetryMode =
  (typeof MANAGED_LORD_DEFECTION_RETRY_MODES)[number];

export const MANAGED_CLANS_AFTER_KINGDOM_DESTRUCTION_MODES = catalogEnumValues<readonly ['Vanilla', 'KeepClans']>('clansAfterKingdomDestruction');
export type ManagedClansAfterKingdomDestructionMode =
  (typeof MANAGED_CLANS_AFTER_KINGDOM_DESTRUCTION_MODES)[number];

export interface ManagedServerProcessConfiguration {
  autosaveMinutes: number;
  logFile: boolean;
  steam: boolean;
  traceTick: boolean;
  tracePublish: boolean;
  traceBandits: boolean;
}
export interface ManagedDifficultyConfiguration {
  playerReceivedDamage: ManagedDifficultyLevel;
  playerTroopsReceivedDamage: ManagedDifficultyLevel;
  combatAIDifficulty: ManagedDifficultyLevel;
  recruitmentDifficulty: ManagedDifficultyLevel;
  playerMapMovementSpeed: ManagedDifficultyLevel;
  stealthAndDisguiseDifficulty: ManagedDifficultyLevel;
  persuasionSuccessChance: ManagedDifficultyLevel;
  clanMemberDeathChance: ManagedDifficultyLevel;
  battleDeath: ManagedDifficultyLevel;
  birthAndDeath: boolean;
  autoAllocateClanMemberPerks: boolean;
}

export interface ManagedVoiceConfiguration {
  mapFullVolumeDistance: number;
  mapMaximumDistance: number;
  sceneFullVolumeDistance: number;
  sceneMaximumDistance: number;
}

export interface ManagedModOptionsConfiguration {
  fastForwardEnabled: boolean;
  autoPauseEnabled: boolean;
  allowClientTimeControls: boolean;
  clientsCanUseCheats: boolean;
  goldFoodInfluenceChangeInSettlements: boolean;
  goldFoodInfluenceChangeInBattles: ManagedGoldFoodChangeMode;
  goldFoodInfluenceChangeForDisconnectedPlayers: boolean;
  voiceEnabled: boolean;
  battleSize: number;
  blockAiWarDeclarationsOnOfflinePlayers: boolean;
  playerBattleAiJoinWindowHours: number;
  postBattleAiAmnestySeconds: number;
  speedLimitWhilePlayersInBattle: boolean;
  ensureUnaffiliatedWanderers: boolean;
  wandererLimit: number;
  spawnRateWanderers: number;
  wandererLimitScalesWithPlayers: boolean;
  playerKingdomClanTierRequired: number;
  coopClansEnabled: boolean;
  smithingStaminaRecoveryOutsideSettlements: boolean;
  smithingStaminaRecoveryMultiplier: number;
  maximumLootersMultiplier: number;
  looterPartySizeMultiplier: number;
  lordDefectionRetries: ManagedLordDefectionRetryMode;
  enableHeroExecutions: boolean;
  enablePlayerClanMemberExecutions: boolean;
  enablePlayerExecutions: boolean;
  playerWoundedBattleEntry: boolean;
  showPlayerNameplates: boolean;
  kingdomDecisionVoteTimeoutSeconds: number;
  clansAfterKingdomDestruction: ManagedClansAfterKingdomDestructionMode;
  preferredBattleHosts: readonly string[];
  pvpBlockLeave: boolean;
  pvpResponseTimerSeconds: number;
  maxClansPerKingdom: number;
  maxClansPerKingdomCountsMercenaries: boolean;
  /** Coop's War Sails (NavalDLC) mode; the dedicated server reads it from mod-config.json. */
  warSails: boolean;
}

export interface ManagedServerConfiguration {
  schemaVersion: 1;
  serverConfig: ManagedServerProcessConfiguration;
  modConfig: {
    voice: ManagedVoiceConfiguration;
    difficulty: ManagedDifficultyConfiguration;
    modOptions: ManagedModOptionsConfiguration;
  };
}

const CATALOG_DEFAULT_MOD_OPTIONS = Object.freeze(Object.fromEntries(
  catalog.options.map((option) => [option.key, option.default]),
)) as unknown as ManagedModOptionsConfiguration;
// Required keys of the released runner 8e5c511d. The other options can be
// absent in older website backups and runner replies.
const RELEASED_REQUIRED_MOD_OPTION_KEYS = new Set<string>([
  'fastForwardEnabled', 'autoPauseEnabled', 'clientsCanUseCheats',
  'goldFoodInfluenceChangeInSettlements', 'goldFoodInfluenceChangeInBattles', 'goldFoodInfluenceChangeForDisconnectedPlayers',
  'playerBattleAiJoinWindowHours', 'speedLimitWhilePlayersInBattle', 'wandererLimit',
  'wandererLimitScalesWithPlayers', 'playerKingdomClanTierRequired', 'smithingStaminaRecoveryOutsideSettlements',
  'smithingStaminaRecoveryMultiplier', 'maximumLootersMultiplier', 'looterPartySizeMultiplier',
  'lordDefectionRetries', 'enableHeroExecutions', 'enablePlayerClanMemberExecutions',
]);
const CATALOG_ADDED_MOD_OPTION_DEFAULTS = Object.freeze(Object.fromEntries(
  catalog.options.filter(({ key }) => !RELEASED_REQUIRED_MOD_OPTION_KEYS.has(key)).map(({ key, default: value }) => [key, value]),
));

export const DEFAULT_MANAGED_SERVER_CONFIGURATION: Readonly<ManagedServerConfiguration> =
  deepFreeze({
    schemaVersion: 1,
    serverConfig: {
      autosaveMinutes: 5,
      logFile: true,
      steam: false,
      traceTick: false,
      tracePublish: false,
      traceBandits: false,
    },
    modConfig: {
      voice: {
        mapFullVolumeDistance: 5,
        mapMaximumDistance: 20,
        sceneFullVolumeDistance: 10,
        sceneMaximumDistance: 50,
      },
      difficulty: {
        playerReceivedDamage: 'VeryEasy',
        playerTroopsReceivedDamage: 'VeryEasy',
        combatAIDifficulty: 'VeryEasy',
        recruitmentDifficulty: 'VeryEasy',
        playerMapMovementSpeed: 'VeryEasy',
        stealthAndDisguiseDifficulty: 'VeryEasy',
        persuasionSuccessChance: 'VeryEasy',
        clanMemberDeathChance: 'VeryEasy',
        battleDeath: 'VeryEasy',
        birthAndDeath: false,
        autoAllocateClanMemberPerks: false,
      },
      modOptions: CATALOG_DEFAULT_MOD_OPTIONS,
    },
  });

/** Returns null when the installed version is unknown or cannot be compared. */
export function isManagedConfigOptionAvailable(
  option: CatalogOption,
  installedVersion: string | null | undefined,
): boolean | null {
  const installed = installedVersion?.match(/(?:^|[^0-9])v?(\d+)\.(\d+)\.(\d+)(?:$|[^0-9])/u);
  if (!installed) return null;
  const required = option.availableSince.split('.').map(Number);
  for (const [index, part] of installed.slice(1).map(Number).entries()) {
    if (part !== required[index]) return part > required[index];
  }
  return true;
}

export type ManagedConfigurationMessages = {
  root: string;
  version: string;
  shape: string;
  boolean: string;
  integer: string;
  number: string;
  choice: string;
};

const defaultConfigurationMessages: ManagedConfigurationMessages = {
  root: 'Managed server configuration root is invalid',
  version: 'Managed server configuration version is invalid',
  shape: 'Managed server configuration shape is invalid',
  boolean: 'Managed server configuration boolean is invalid',
  integer: 'Managed server configuration integer is invalid',
  number: 'Managed server configuration number is invalid',
  choice: 'Managed server configuration choice is invalid',
};

// Validates and freezes configuration using caller-provided diagnostics without request dependencies.
export function parseManagedServerConfiguration(
  value: unknown,
  messages: ManagedConfigurationMessages = defaultConfigurationMessages,
  mode: 'edit' | 'read' = 'edit',
): ManagedServerConfiguration {
  if (!isExactRecord(value, ['schemaVersion', 'serverConfig', 'modConfig'])) {
    throw new Error(messages.root);
  }
  if (value.schemaVersion !== 1) throw new Error(messages.version);
  const serverConfig = requireExactRecord(value.serverConfig, [
    'autosaveMinutes',
    'logFile',
    'steam',
    'traceTick',
    'tracePublish',
    'traceBandits',
  ], messages);
  const modConfig = requireCompatibleRecord(value.modConfig, ['difficulty', 'modOptions'], {
    voice: DEFAULT_MANAGED_SERVER_CONFIGURATION.modConfig.voice,
  }, messages);
  const difficulty = requireExactRecord(modConfig.difficulty, [
    'playerReceivedDamage',
    'playerTroopsReceivedDamage',
    'combatAIDifficulty',
    'recruitmentDifficulty',
    'playerMapMovementSpeed',
    'stealthAndDisguiseDifficulty',
    'persuasionSuccessChance',
    'clanMemberDeathChance',
    'battleDeath',
    'birthAndDeath',
    'autoAllocateClanMemberPerks',
  ], messages);
  const modOptions = requireCompatibleRecord(modConfig.modOptions, [...RELEASED_REQUIRED_MOD_OPTION_KEYS], CATALOG_ADDED_MOD_OPTION_DEFAULTS, messages);
  const validatedModOptions = validateCatalogManagedOptions(modOptions, messages, catalog.options, mode);
  return deepFreeze({
    schemaVersion: 1,
    serverConfig: {
      autosaveMinutes: requireInteger(serverConfig.autosaveMinutes, 0, 1_440, messages),
      logFile: requireBoolean(serverConfig.logFile, messages),
      steam: requireBoolean(serverConfig.steam, messages),
      traceTick: requireBoolean(serverConfig.traceTick, messages),
      tracePublish: requireBoolean(serverConfig.tracePublish, messages),
      traceBandits: requireBoolean(serverConfig.traceBandits, messages),
    },
    modConfig: {
      voice: {
        mapFullVolumeDistance: requireVoiceDistance(modConfig.voice, 'mapFullVolumeDistance', messages),
        mapMaximumDistance: requireVoiceDistance(modConfig.voice, 'mapMaximumDistance', messages),
        sceneFullVolumeDistance: requireVoiceDistance(modConfig.voice, 'sceneFullVolumeDistance', messages),
        sceneMaximumDistance: requireVoiceDistance(modConfig.voice, 'sceneMaximumDistance', messages),
      },
      difficulty: {
        playerReceivedDamage: requireEnum(difficulty.playerReceivedDamage, MANAGED_DIFFICULTY_LEVELS, messages),
        playerTroopsReceivedDamage: requireEnum(difficulty.playerTroopsReceivedDamage, MANAGED_DIFFICULTY_LEVELS, messages),
        combatAIDifficulty: requireEnum(difficulty.combatAIDifficulty, MANAGED_DIFFICULTY_LEVELS, messages),
        recruitmentDifficulty: requireEnum(difficulty.recruitmentDifficulty, MANAGED_DIFFICULTY_LEVELS, messages),
        playerMapMovementSpeed: requireEnum(difficulty.playerMapMovementSpeed, MANAGED_DIFFICULTY_LEVELS, messages),
        stealthAndDisguiseDifficulty: requireEnum(difficulty.stealthAndDisguiseDifficulty, MANAGED_DIFFICULTY_LEVELS, messages),
        persuasionSuccessChance: requireEnum(difficulty.persuasionSuccessChance, MANAGED_DIFFICULTY_LEVELS, messages),
        clanMemberDeathChance: requireEnum(difficulty.clanMemberDeathChance, MANAGED_DIFFICULTY_LEVELS, messages),
        battleDeath: requireEnum(difficulty.battleDeath, MANAGED_DIFFICULTY_LEVELS, messages),
        birthAndDeath: requireBoolean(difficulty.birthAndDeath, messages),
        autoAllocateClanMemberPerks: requireBoolean(difficulty.autoAllocateClanMemberPerks, messages),
      },
      modOptions: validatedModOptions,
    },
  });
}

export function validateCatalogManagedOptions(
  value: Record<string, unknown>,
  messages: ManagedConfigurationMessages,
  options: readonly CatalogOption[] = catalog.options,
  mode: 'edit' | 'read' = 'edit',
): ManagedModOptionsConfiguration {
  const validated: Record<string, unknown> = {};
  for (const option of options) {
    const raw = value[option.key];
    if (raw === undefined) throw new Error(messages.shape);
    if (option.type === 'integer' && !Number.isSafeInteger(raw)) throw new Error(messages.integer);
    const coercion = option.coerceRanges?.find(([from, to]) => typeof raw === 'number' && raw >= from && raw <= to);
    const actual = coercion === undefined ? raw : coercion[2];
    if (option.type === 'boolean' && typeof actual !== 'boolean') throw new Error(messages.boolean);
    if (option.type === 'number' && (typeof actual !== 'number' || !Number.isFinite(actual))) throw new Error(messages.number);
    if (option.type === 'enum' && (typeof actual !== 'string' || option.values?.includes(actual) !== true)) throw new Error(messages.choice);
    if (option.type === 'stringList' && (!Array.isArray(actual) || actual.some((entry) => typeof entry !== 'string'))) throw new Error(messages.shape);
    const { min, max } = mode === 'edit' ? managedConfigNumericBounds(option, 12_000)
      : { min: option.min, max: option.key === 'battleSize' ? 12_000 : option.max };
    if (min !== undefined && (actual as number) < min || max !== undefined && (actual as number) > max) {
      throw new Error(option.type === 'integer' ? messages.integer : messages.number);
    }
    if (option.type === 'stringList') {
      const list = actual as string[];
      if (list.length > MANAGED_LIST_MAX_ITEMS || option.uniqueItems === true && new Set(list).size !== list.length) throw new Error(messages.shape);
      if (list.some((entry) => !managedConfigListItemMatches(option, entry))) throw new Error(messages.shape);
    }
    validated[option.key] = actual;
  }
  return validated as unknown as ManagedModOptionsConfiguration;
}

export function cloneManagedServerConfiguration(
  value: ManagedServerConfiguration,
): ManagedServerConfiguration {
  return parseManagedServerConfiguration(JSON.parse(JSON.stringify(value)) as unknown);
}

export function canonicalManagedServerConfiguration(value: ManagedServerConfiguration): string {
  return JSON.stringify(parseManagedServerConfiguration(value));
}

// Requires the existing exact object shape with the selected diagnostic.
function requireExactRecord(
  value: unknown,
  keys: readonly string[],
  messages: ManagedConfigurationMessages,
): Record<string, unknown> {
  if (!isExactRecord(value, keys)) throw new Error(messages.shape);
  return value;
}

// Requires the listed keys and fills the defaults of keys added after schema version 1.
function requireCompatibleRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalDefaults: Readonly<Record<string, unknown>>,
  messages: ManagedConfigurationMessages,
): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new Error(messages.shape);
  const allowed = new Set([...requiredKeys, ...Object.keys(optionalDefaults)]);
  const actual = Object.keys(value);
  if (actual.some((key) => !allowed.has(key)) || requiredKeys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(messages.shape);
  }
  return { ...optionalDefaults, ...value };
}

function requireVoiceDistance(value: unknown, key: string, messages: ManagedConfigurationMessages): number {
  if (!isPlainRecord(value)) throw new Error(messages.shape);
  const distance = requireNumber(value[key], 0, 100_000, messages);
  const pair = key.startsWith('map')
    ? (key === 'mapFullVolumeDistance' ? value.mapMaximumDistance : value.mapFullVolumeDistance)
    : (key === 'sceneFullVolumeDistance' ? value.sceneMaximumDistance : value.sceneFullVolumeDistance);
  if (key.endsWith('MaximumDistance') && distance <= Number(pair)) throw new Error(messages.number);
  if (key.endsWith('FullVolumeDistance') && Number(pair) <= distance) throw new Error(messages.number);
  return distance;
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

// Requires a boolean without coercion, using the selected diagnostic.
function requireBoolean(value: unknown, messages: ManagedConfigurationMessages): boolean {
  if (typeof value !== 'boolean') throw new Error(messages.boolean);
  return value;
}

// Requires a safe integer within the unchanged bounds.
function requireInteger(value: unknown, minimum: number, maximum: number, messages: ManagedConfigurationMessages): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(messages.integer);
  }
  return value as number;
}

// Requires a finite number within the unchanged bounds.
function requireNumber(value: unknown, minimum: number, maximum: number, messages: ManagedConfigurationMessages): number {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < minimum
    || value > maximum
  ) throw new Error(messages.number);
  return value;
}

// Requires an unchanged configuration choice without translating its stored value.
function requireEnum<const T extends readonly string[]>(value: unknown, values: T, messages: ManagedConfigurationMessages): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new Error(messages.choice);
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
