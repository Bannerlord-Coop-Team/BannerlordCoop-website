export const MANAGED_DIFFICULTY_LEVELS = ['VeryEasy', 'Easy', 'Realistic'] as const;
export type ManagedDifficultyLevel = (typeof MANAGED_DIFFICULTY_LEVELS)[number];

export const MANAGED_GOLD_FOOD_CHANGE_MODES = ['Disabled', 'OneDayMax', 'Enabled'] as const;
export type ManagedGoldFoodChangeMode = (typeof MANAGED_GOLD_FOOD_CHANGE_MODES)[number];

export const MANAGED_LORD_DEFECTION_RETRY_MODES = [
  'Vanilla',
  'NeverExpire',
  'AlwaysRetry',
] as const;
export type ManagedLordDefectionRetryMode =
  (typeof MANAGED_LORD_DEFECTION_RETRY_MODES)[number];

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

export interface ManagedModOptionsConfiguration {
  fastForwardEnabled: boolean;
  autoPauseEnabled: boolean;
  clientsCanUseCheats: boolean;
  goldFoodInfluenceChangeInSettlements: boolean;
  goldFoodInfluenceChangeInBattles: ManagedGoldFoodChangeMode;
  goldFoodInfluenceChangeForDisconnectedPlayers: boolean;
  playerBattleAiJoinWindowHours: number;
  speedLimitWhilePlayersInBattle: boolean;
  wandererLimit: number;
  wandererLimitScalesWithPlayers: boolean;
  playerKingdomClanTierRequired: number;
  smithingStaminaRecoveryOutsideSettlements: boolean;
  smithingStaminaRecoveryMultiplier: number;
  maximumLootersMultiplier: number;
  looterPartySizeMultiplier: number;
  lordDefectionRetries: ManagedLordDefectionRetryMode;
  enableHeroExecutions: boolean;
  enablePlayerClanMemberExecutions: boolean;
}

export interface ManagedServerConfiguration {
  schemaVersion: 1;
  serverConfig: ManagedServerProcessConfiguration;
  modConfig: {
    difficulty: ManagedDifficultyConfiguration;
    modOptions: ManagedModOptionsConfiguration;
  };
}

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
      modOptions: {
        fastForwardEnabled: true,
        autoPauseEnabled: true,
        clientsCanUseCheats: false,
        goldFoodInfluenceChangeInSettlements: true,
        goldFoodInfluenceChangeInBattles: 'OneDayMax',
        goldFoodInfluenceChangeForDisconnectedPlayers: false,
        playerBattleAiJoinWindowHours: 24,
        speedLimitWhilePlayersInBattle: true,
        wandererLimit: 32,
        wandererLimitScalesWithPlayers: false,
        playerKingdomClanTierRequired: 4,
        smithingStaminaRecoveryOutsideSettlements: true,
        smithingStaminaRecoveryMultiplier: 0.1,
        maximumLootersMultiplier: 1,
        looterPartySizeMultiplier: 1,
        lordDefectionRetries: 'Vanilla',
        enableHeroExecutions: true,
        enablePlayerClanMemberExecutions: false,
      },
    },
  });

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
  const modConfig = requireExactRecord(value.modConfig, ['difficulty', 'modOptions'], messages);
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
  const modOptions = requireExactRecord(modConfig.modOptions, [
    'fastForwardEnabled',
    'autoPauseEnabled',
    'clientsCanUseCheats',
    'goldFoodInfluenceChangeInSettlements',
    'goldFoodInfluenceChangeInBattles',
    'goldFoodInfluenceChangeForDisconnectedPlayers',
    'playerBattleAiJoinWindowHours',
    'speedLimitWhilePlayersInBattle',
    'wandererLimit',
    'wandererLimitScalesWithPlayers',
    'playerKingdomClanTierRequired',
    'smithingStaminaRecoveryOutsideSettlements',
    'smithingStaminaRecoveryMultiplier',
    'maximumLootersMultiplier',
    'looterPartySizeMultiplier',
    'lordDefectionRetries',
    'enableHeroExecutions',
    'enablePlayerClanMemberExecutions',
  ], messages);
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
        fastForwardEnabled: requireBoolean(modOptions.fastForwardEnabled, messages),
        autoPauseEnabled: requireBoolean(modOptions.autoPauseEnabled, messages),
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
        playerBattleAiJoinWindowHours: requireInteger(
          modOptions.playerBattleAiJoinWindowHours,
          0,
          8_760, messages,
        ),
        speedLimitWhilePlayersInBattle: requireBoolean(modOptions.speedLimitWhilePlayersInBattle, messages),
        wandererLimit: requireInteger(modOptions.wandererLimit, 0, 1_000, messages),
        wandererLimitScalesWithPlayers: requireBoolean(modOptions.wandererLimitScalesWithPlayers, messages),
        playerKingdomClanTierRequired: requireInteger(
          modOptions.playerKingdomClanTierRequired,
          0,
          6, messages,
        ),
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
      },
    },
  });
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
