import rawCatalog from './managed-config-catalog-generated.ts';

type CatalogOption = { key: string; type: string; stable: boolean; default: unknown; min?: number; max?: number;
  itemPattern?: string; maxItems?: number; uniqueItems?: boolean; omitForOldAgents?: boolean;
  availableSince?: string; values?: readonly string[]; forbiddenRanges?: readonly (readonly [number?, number?])[] };
type Catalog = { schemaVersion: number; catalogRevision: string; contentDigest: string; sourceCommit: string; options: readonly CatalogOption[] };
const catalog = rawCatalog as unknown as Catalog;

function validateCatalogStructure(): void {
  if (catalog.schemaVersion !== 2 || catalog.catalogRevision !== catalog.contentDigest
    || !/^[0-9a-f]{64}$/u.test(catalog.catalogRevision) || !/^[0-9a-f]{40}$/u.test(catalog.sourceCommit)
    || catalog.options.length === 0) throw new Error('Managed configuration catalog is malformed');
  const keys = new Set<string>();
  for (const option of catalog.options) {
    if (!/^[a-z][A-Za-z0-9]*$/u.test(option.key) || keys.has(option.key)
      || !['boolean', 'integer', 'number', 'enum', 'steamIdList'].includes(option.type)
      || option.default === undefined) throw new Error(`Managed configuration catalog option is malformed: ${option.key}`);
    keys.add(option.key);
    if (option.type === 'boolean' && typeof option.default !== 'boolean') throw new Error(`Managed configuration catalog default is malformed: ${option.key}`);
    if (option.type === 'integer' && !Number.isSafeInteger(option.default)) throw new Error(`Managed configuration catalog default is malformed: ${option.key}`);
    if (option.type === 'number' && (typeof option.default !== 'number' || !Number.isFinite(option.default))) throw new Error(`Managed configuration catalog default is malformed: ${option.key}`);
    if (option.min !== undefined && (option.default as number) < option.min || option.max !== undefined && (option.default as number) > option.max) throw new Error(`Managed configuration catalog bounds are malformed: ${option.key}`);
    if (option.type === 'enum' && (option.values === undefined || !option.values.includes(String(option.default)))) throw new Error(`Managed configuration catalog enum is malformed: ${option.key}`);
  }
}

validateCatalogStructure();

export const MANAGED_DIFFICULTY_LEVELS = ['VeryEasy', 'Easy', 'Realistic'] as const;
export type ManagedDifficultyLevel = (typeof MANAGED_DIFFICULTY_LEVELS)[number];

export const MANAGED_GOLD_FOOD_CHANGE_MODES = ['Disabled', 'OneDayMax', 'Enabled'] as const;
export type ManagedGoldFoodChangeMode = (typeof MANAGED_GOLD_FOOD_CHANGE_MODES)[number];

export const MANAGED_LORD_DEFECTION_RETRY_MODES = ['Vanilla', 'NeverExpire', 'AlwaysRetry'] as const;
export type ManagedLordDefectionRetryMode =
  (typeof MANAGED_LORD_DEFECTION_RETRY_MODES)[number];

export const MANAGED_CLANS_AFTER_KINGDOM_DESTRUCTION_MODES = ['Vanilla', 'KeepClans'] as const;
export type ManagedClansAfterKingdomDestructionMode =
  (typeof MANAGED_CLANS_AFTER_KINGDOM_DESTRUCTION_MODES)[number];

if (JSON.stringify(MANAGED_GOLD_FOOD_CHANGE_MODES) !== JSON.stringify(catalogOption('goldFoodInfluenceChangeInBattles').values)
  || JSON.stringify(MANAGED_LORD_DEFECTION_RETRY_MODES) !== JSON.stringify(catalogOption('lordDefectionRetries').values)
  || JSON.stringify(MANAGED_CLANS_AFTER_KINGDOM_DESTRUCTION_MODES) !== JSON.stringify(catalogOption('clansAfterKingdomDestruction').values)) {
  throw new Error('Managed configuration enum definitions differ from the catalog');
}

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
const CATALOG_ADDED_MOD_OPTION_DEFAULTS = Object.freeze(Object.fromEntries(
  catalog.options.filter((option) => option.omitForOldAgents === true).map((option) => [option.key, option.default]),
));
const CATALOG_LEGACY_MOD_OPTION_KEYS = catalog.options
  .filter((option) => option.omitForOldAgents !== true)
  .map((option) => option.key);

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

export function assertManagedConfigurationAvailableForChannel(
  modOptions: object,
  channel: 'stable' | 'nightly',
): void {
  assertManagedConfigurationAvailableForInstalledBuild(modOptions, channel === 'stable' ? '0.1.7' : '0.1.8', channel);
}

export function assertManagedConfigurationAvailableForInstalledBuild(
  modOptions: object,
  installedBuildVersion: string | null,
  channel: 'stable' | 'nightly',
): void {
  const parseVersion = (value: string) => value.match(/(?:^|[^0-9])v?(\d+)\.(\d+)\.(\d+)(?:$|[^0-9])/u);
  for (const [key, value] of Object.entries(modOptions)) {
    const option = catalog.options.find(candidate => candidate.key === key);
    if (option === undefined || JSON.stringify(value) === JSON.stringify(option.default)) continue;
    if (channel === 'stable' && option.stable === false) throw new Error(`${key} is available on Nightly only; switch this server to Nightly before changing it`);
    if (installedBuildVersion === null) throw new Error(`${key} is unavailable until the installed build version is known`);
    const installed = parseVersion(installedBuildVersion);
    const required = option.availableSince === undefined ? null : parseVersion(option.availableSince);
    const installedParts = installed?.slice(1).map(Number);
    const requiredParts = required?.slice(1).map(Number);
    const older = installedParts === undefined || requiredParts === undefined
      || installedParts.some((part, index) => part < (requiredParts[index] ?? part)
        || part > (requiredParts[index] ?? part) && installedParts.slice(0, index).every((previous, previousIndex) => previous === requiredParts[previousIndex]));
    if (older) {
      throw new Error(`${key} is unavailable in the installed build`);
    }
  }
}

function catalogOption(key: string) {
  const option = catalog.options.find(candidate => candidate.key === key);
  if (option === undefined) throw new Error(`Managed configuration catalog option is missing: ${key}`);
  return option as CatalogOption;
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
  const modOptions = requireCompatibleRecord(modConfig.modOptions, CATALOG_LEGACY_MOD_OPTION_KEYS, CATALOG_ADDED_MOD_OPTION_DEFAULTS, messages);
  validateCatalogManagedOptions(modOptions, messages);
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
      modOptions: {
        voiceEnabled: requireBoolean(modOptions.voiceEnabled, messages),
        // The game clamps battle size to this range.
        battleSize: requireInteger(modOptions.battleSize, 200, 12_000, messages),
        fastForwardEnabled: requireBoolean(modOptions.fastForwardEnabled, messages),
        autoPauseEnabled: requireBoolean(modOptions.autoPauseEnabled, messages),
        allowClientTimeControls: requireBoolean(modOptions.allowClientTimeControls, messages),
        clientsCanUseCheats: requireBoolean(modOptions.clientsCanUseCheats, messages),
        goldFoodInfluenceChangeInSettlements: requireBoolean(
          modOptions.goldFoodInfluenceChangeInSettlements, messages,
        ),
        goldFoodInfluenceChangeInBattles: requireEnum(
          modOptions.goldFoodInfluenceChangeInBattles,
          MANAGED_GOLD_FOOD_CHANGE_MODES, messages,
        ),
        goldFoodInfluenceChangeForDisconnectedPlayers: requireBoolean(
          modOptions.goldFoodInfluenceChangeForDisconnectedPlayers, messages,
        ),
        blockAiWarDeclarationsOnOfflinePlayers: requireBoolean(
          modOptions.blockAiWarDeclarationsOnOfflinePlayers, messages,
        ),
        playerBattleAiJoinWindowHours: requireInteger(
          modOptions.playerBattleAiJoinWindowHours,
          0,
          8_760, messages,
        ),
        postBattleAiAmnestySeconds: requireInteger(modOptions.postBattleAiAmnestySeconds, catalogOption('postBattleAiAmnestySeconds').min ?? 0, catalogOption('postBattleAiAmnestySeconds').max ?? 86_400, messages),
        speedLimitWhilePlayersInBattle: requireBoolean(modOptions.speedLimitWhilePlayersInBattle, messages),
        ensureUnaffiliatedWanderers: requireBoolean(modOptions.ensureUnaffiliatedWanderers, messages),
        wandererLimit: requireInteger(modOptions.wandererLimit, 0, 1_000, messages),
        spawnRateWanderers: requireInteger(modOptions.spawnRateWanderers, catalogOption('spawnRateWanderers').min ?? 0, catalogOption('spawnRateWanderers').max ?? 100, messages),
        wandererLimitScalesWithPlayers: requireBoolean(modOptions.wandererLimitScalesWithPlayers, messages),
        playerKingdomClanTierRequired: requireInteger(
          modOptions.playerKingdomClanTierRequired,
          0,
          6, messages,
        ),
        coopClansEnabled: requireBoolean(modOptions.coopClansEnabled, messages),
        smithingStaminaRecoveryOutsideSettlements: requireBoolean(
          modOptions.smithingStaminaRecoveryOutsideSettlements, messages,
        ),
        smithingStaminaRecoveryMultiplier: requireNumber(
          modOptions.smithingStaminaRecoveryMultiplier,
          0,
          100, messages,
        ),
        maximumLootersMultiplier: requireNumber(modOptions.maximumLootersMultiplier, 0, 100, messages),
        looterPartySizeMultiplier: requireNumber(modOptions.looterPartySizeMultiplier, 0, 100, messages),
        lordDefectionRetries: requireEnum(
          modOptions.lordDefectionRetries,
          MANAGED_LORD_DEFECTION_RETRY_MODES, messages,
        ),
        enableHeroExecutions: requireBoolean(modOptions.enableHeroExecutions, messages),
        enablePlayerClanMemberExecutions: requireBoolean(
          modOptions.enablePlayerClanMemberExecutions, messages,
        ),
        enablePlayerExecutions: requireBoolean(modOptions.enablePlayerExecutions, messages),
        playerWoundedBattleEntry: requireBoolean(modOptions.playerWoundedBattleEntry, messages),
        showPlayerNameplates: requireBoolean(modOptions.showPlayerNameplates, messages),
        kingdomDecisionVoteTimeoutSeconds: requireInteger(modOptions.kingdomDecisionVoteTimeoutSeconds, catalogOption('kingdomDecisionVoteTimeoutSeconds').min ?? 1, catalogOption('kingdomDecisionVoteTimeoutSeconds').max ?? 86_400, messages),
        clansAfterKingdomDestruction: requireEnum(
          modOptions.clansAfterKingdomDestruction,
          MANAGED_CLANS_AFTER_KINGDOM_DESTRUCTION_MODES, messages,
        ),
        preferredBattleHosts: requireSteamIdList(modOptions.preferredBattleHosts, messages),
        pvpBlockLeave: requireBoolean(modOptions.pvpBlockLeave, messages),
        pvpResponseTimerSeconds: requirePvpResponseTimer(modOptions.pvpResponseTimerSeconds, messages),
        warSails: requireBoolean(modOptions.warSails, messages),
      },
    },
  });
}

function validateCatalogManagedOptions(value: Record<string, unknown>, messages: ManagedConfigurationMessages): void {
  for (const option of catalog.options) {
    const actual = value[option.key];
    if (actual === undefined) throw new Error(messages.shape);
    if (option.type === 'boolean' && typeof actual !== 'boolean') throw new Error(messages.boolean);
    if (option.type === 'integer' && !Number.isSafeInteger(actual)) throw new Error(messages.integer);
    if (option.type === 'number' && (typeof actual !== 'number' || !Number.isFinite(actual))) throw new Error(messages.number);
    if (option.type === 'enum' && (typeof actual !== 'string' || option.values?.includes(actual) !== true)) throw new Error(messages.choice);
    if (option.type === 'steamIdList' && (!Array.isArray(actual) || actual.some((entry) => typeof entry !== 'string'))) throw new Error(messages.shape);
    if (option.min !== undefined && (actual as number) < option.min) throw new Error(option.type === 'integer' ? messages.integer : messages.number);
    if (option.max !== undefined && (actual as number) > option.max) throw new Error(option.type === 'integer' ? messages.integer : messages.number);
    if (option.type === 'steamIdList') {
      const list = actual as string[];
      if (option.maxItems !== undefined && list.length > option.maxItems) throw new Error(messages.shape);
      if (option.uniqueItems === true && new Set(list).size !== list.length) throw new Error(messages.shape);
      if (option.itemPattern !== undefined && list.some((entry) => !new RegExp(option.itemPattern as string, 'u').test(entry))) throw new Error(messages.shape);
    }
    if (option.forbiddenRanges?.some(([from, to]) => typeof actual === 'number' && actual >= (from ?? Number.NEGATIVE_INFINITY) && actual <= (to ?? Number.POSITIVE_INFINITY))) throw new Error(option.type === 'integer' ? messages.integer : messages.number);
  }
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

function requireSteamIdList(value: unknown, messages: ManagedConfigurationMessages): readonly string[] {
  const catalog = catalogOption('preferredBattleHosts');
  const pattern = new RegExp(catalog.itemPattern ?? '^[0-9]{17}$', 'u');
  if (!Array.isArray(value) || value.length > (catalog.maxItems ?? 32)) throw new Error(messages.shape);
  const ids = value.map((entry) => {
    if (typeof entry !== 'string' || !pattern.test(entry)) throw new Error(messages.shape);
    return entry;
  });
  if (new Set(ids).size !== ids.length) throw new Error(messages.shape);
  return ids;
}

function requirePvpResponseTimer(value: unknown, messages: ManagedConfigurationMessages): number {
  const catalog = catalogOption('pvpResponseTimerSeconds');
  const seconds = requireInteger(value, catalog.min ?? 0, catalog.max ?? 86_400, messages);
  if ((catalog.forbiddenRanges ?? []).some(([minimum, maximum]) => seconds >= (minimum ?? 0) && seconds <= (maximum ?? 86_400))) throw new Error(messages.integer);
  return seconds;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}


