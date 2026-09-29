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

export function parseManagedServerConfiguration(value: unknown): ManagedServerConfiguration {
  if (!isExactRecord(value, ['schemaVersion', 'serverConfig', 'modConfig'])) {
    throw new Error('Managed server configuration root is invalid');
  }
  if (value.schemaVersion !== 1) throw new Error('Managed server configuration version is invalid');
  const serverConfig = requireExactRecord(value.serverConfig, [
    'autosaveMinutes',
    'logFile',
    'steam',
    'traceTick',
    'tracePublish',
    'traceBandits',
  ]);
  const modConfig = requireExactRecord(value.modConfig, ['difficulty', 'modOptions']);
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
  ]);
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
  ]);
  return deepFreeze({
    schemaVersion: 1,
    serverConfig: {
      autosaveMinutes: requireInteger(serverConfig.autosaveMinutes, 0, 1_440),
      logFile: requireBoolean(serverConfig.logFile),
      steam: requireBoolean(serverConfig.steam),
      traceTick: requireBoolean(serverConfig.traceTick),
      tracePublish: requireBoolean(serverConfig.tracePublish),
      traceBandits: requireBoolean(serverConfig.traceBandits),
    },
    modConfig: {
      difficulty: {
        playerReceivedDamage: requireEnum(difficulty.playerReceivedDamage, MANAGED_DIFFICULTY_LEVELS),
        playerTroopsReceivedDamage: requireEnum(difficulty.playerTroopsReceivedDamage, MANAGED_DIFFICULTY_LEVELS),
        combatAIDifficulty: requireEnum(difficulty.combatAIDifficulty, MANAGED_DIFFICULTY_LEVELS),
        recruitmentDifficulty: requireEnum(difficulty.recruitmentDifficulty, MANAGED_DIFFICULTY_LEVELS),
        playerMapMovementSpeed: requireEnum(difficulty.playerMapMovementSpeed, MANAGED_DIFFICULTY_LEVELS),
        stealthAndDisguiseDifficulty: requireEnum(difficulty.stealthAndDisguiseDifficulty, MANAGED_DIFFICULTY_LEVELS),
        persuasionSuccessChance: requireEnum(difficulty.persuasionSuccessChance, MANAGED_DIFFICULTY_LEVELS),
        clanMemberDeathChance: requireEnum(difficulty.clanMemberDeathChance, MANAGED_DIFFICULTY_LEVELS),
        battleDeath: requireEnum(difficulty.battleDeath, MANAGED_DIFFICULTY_LEVELS),
        birthAndDeath: requireBoolean(difficulty.birthAndDeath),
        autoAllocateClanMemberPerks: requireBoolean(difficulty.autoAllocateClanMemberPerks),
      },
      modOptions: {
        fastForwardEnabled: requireBoolean(modOptions.fastForwardEnabled),
        autoPauseEnabled: requireBoolean(modOptions.autoPauseEnabled),
        clientsCanUseCheats: requireBoolean(modOptions.clientsCanUseCheats),
        goldFoodInfluenceChangeInSettlements: requireBoolean(
          modOptions.goldFoodInfluenceChangeInSettlements,
        ),
        goldFoodInfluenceChangeInBattles: requireEnum(
          modOptions.goldFoodInfluenceChangeInBattles,
          MANAGED_GOLD_FOOD_CHANGE_MODES,
        ),
        goldFoodInfluenceChangeForDisconnectedPlayers: requireBoolean(
          modOptions.goldFoodInfluenceChangeForDisconnectedPlayers,
        ),
        playerBattleAiJoinWindowHours: requireInteger(
          modOptions.playerBattleAiJoinWindowHours,
          0,
          8_760,
        ),
        speedLimitWhilePlayersInBattle: requireBoolean(modOptions.speedLimitWhilePlayersInBattle),
        wandererLimit: requireInteger(modOptions.wandererLimit, 0, 1_000),
        wandererLimitScalesWithPlayers: requireBoolean(modOptions.wandererLimitScalesWithPlayers),
        playerKingdomClanTierRequired: requireInteger(
          modOptions.playerKingdomClanTierRequired,
          0,
          6,
        ),
        smithingStaminaRecoveryOutsideSettlements: requireBoolean(
          modOptions.smithingStaminaRecoveryOutsideSettlements,
        ),
        smithingStaminaRecoveryMultiplier: requireNumber(
          modOptions.smithingStaminaRecoveryMultiplier,
          0,
          100,
        ),
        maximumLootersMultiplier: requireNumber(modOptions.maximumLootersMultiplier, 0, 100),
        looterPartySizeMultiplier: requireNumber(modOptions.looterPartySizeMultiplier, 0, 100),
        lordDefectionRetries: requireEnum(
          modOptions.lordDefectionRetries,
          MANAGED_LORD_DEFECTION_RETRY_MODES,
        ),
        enableHeroExecutions: requireBoolean(modOptions.enableHeroExecutions),
        enablePlayerClanMemberExecutions: requireBoolean(
          modOptions.enablePlayerClanMemberExecutions,
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

function requireExactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!isExactRecord(value, keys)) throw new Error('Managed server configuration shape is invalid');
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

function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Managed server configuration boolean is invalid');
  return value;
}

function requireInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error('Managed server configuration integer is invalid');
  }
  return value as number;
}

function requireNumber(value: unknown, minimum: number, maximum: number): number {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < minimum
    || value > maximum
  ) throw new Error('Managed server configuration number is invalid');
  return value;
}

function requireEnum<const T extends readonly string[]>(value: unknown, values: T): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new Error('Managed server configuration choice is invalid');
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
