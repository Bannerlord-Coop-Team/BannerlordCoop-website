import assert from 'node:assert/strict';
import test from 'node:test';
import catalog from './managed-config-catalog.json' with { type: 'json' };
import source from './managed-config-catalog-source.json' with { type: 'json' };
import generatedCatalog from './managed-config-catalog-generated.ts';
import {
  DEFAULT_MANAGED_SERVER_CONFIGURATION,
  isManagedConfigOptionAvailable,
  MANAGED_CONFIG_CATALOG_OPTIONS,
  managedConfigNumericBounds,
  parseManagedServerConfiguration,
  validateCatalogManagedOptions,
  validateManagedConfigCatalog,
  type ManagedConfigurationMessages,
} from './managed-server-configuration';

const messages: ManagedConfigurationMessages = {
  root: 'localized root', version: 'localized version', shape: 'localized shape',
  boolean: 'localized boolean', integer: 'localized integer', number: 'localized number',
  choice: 'localized choice',
};

// Creates independently mutable input for each parser validation path.
function configuration() {
  return structuredClone(DEFAULT_MANAGED_SERVER_CONFIGURATION);
}

// Matrix: each diagnostic retains its default and accepts an injected message without changing rejection.
const invalidInputs: [keyof ManagedConfigurationMessages, () => unknown][] = [
  ['root', () => null],
  ['version', () => ({ ...configuration(), schemaVersion: 2 })],
  ['shape', () => ({ ...configuration(), serverConfig: {} })],
  ['boolean', () => { const value = configuration(); Object.assign(value.serverConfig, { logFile: 'true' }); return value; }],
  ['integer', () => { const value = configuration(); value.serverConfig.autosaveMinutes = 0.5; return value; }],
  ['number', () => { const value = configuration(); value.modConfig.modOptions.maximumLootersMultiplier = Infinity; return value; }],
  ['choice', () => { const value = configuration(); Object.assign(value.modConfig.difficulty, { battleDeath: 'Other' }); return value; }],
];
for (const [kind, input] of invalidInputs) {
  test(`${kind} validation preserves default English and injects only its diagnostic`, () => {
    assert.throws(() => parseManagedServerConfiguration(input()), { message: `Managed server configuration ${kind} is invalid` });
    assert.throws(() => parseManagedServerConfiguration(input(), messages), { message: messages[kind] });
  });
}

test('injected messages preserve accepted values and recursive freezing', () => {
  const input = configuration();
  input.serverConfig.autosaveMinutes = 1440;
  input.modConfig.modOptions.maximumLootersMultiplier = 0.25;
  const result = parseManagedServerConfiguration(input, messages);
  assert.deepEqual(result, parseManagedServerConfiguration(input));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.modConfig.modOptions), true);
  assert.equal(Object.isFrozen(input), false);
});

test('battle size defaults when omitted and accepts only whole sizes the game applies', () => {
  const omitted = configuration() as { modConfig: { modOptions: Partial<typeof DEFAULT_MANAGED_SERVER_CONFIGURATION.modConfig.modOptions> } };
  delete omitted.modConfig.modOptions.battleSize;
  assert.equal(parseManagedServerConfiguration(omitted).modConfig.modOptions.battleSize, 1000);
  for (const accepted of [200, 1000, 12000]) {
    const value = configuration();
    value.modConfig.modOptions.battleSize = accepted;
    assert.equal(parseManagedServerConfiguration(value).modConfig.modOptions.battleSize, accepted);
  }
  for (const rejected of [199, 12001, 500.5]) {
    const value = configuration();
    value.modConfig.modOptions.battleSize = rejected;
    assert.throws(() => parseManagedServerConfiguration(value, messages), { message: messages.integer });
  }
});

test('War Sails defaults to off when omitted and accepts only a boolean', () => {
  const omitted = configuration() as { modConfig: { modOptions: Partial<typeof DEFAULT_MANAGED_SERVER_CONFIGURATION.modConfig.modOptions> } };
  delete omitted.modConfig.modOptions.warSails;
  assert.equal(parseManagedServerConfiguration(omitted).modConfig.modOptions.warSails, false);
  for (const warSails of [true, false]) {
    const value = configuration();
    value.modConfig.modOptions.warSails = warSails;
    assert.equal(parseManagedServerConfiguration(value).modConfig.modOptions.warSails, warSails);
  }
  const invalid = configuration();
  Object.assign(invalid.modConfig.modOptions, { warSails: 'true' });
  assert.throws(() => parseManagedServerConfiguration(invalid, messages), { message: messages.boolean });
});

test('the website schema matches the generated build catalog and round-trips all drifted options', () => {
  assert.deepEqual(
    Object.keys(DEFAULT_MANAGED_SERVER_CONFIGURATION.modConfig.modOptions).sort(),
    catalog.options.map(option => option.key).sort(),
  );
  assert.equal(catalog.contentDigest, 'ec2faa9b93477e6a0627f88859f5c627a179c5ceb07e111f92d856b4e5c817eb');
  assert.equal(source.contentDigest, catalog.contentDigest);
  assert.equal(source.sourceCommit, '0a586b954ab9dcd59b136801184ac85e495b4779');
  assert.deepEqual(generatedCatalog, catalog);
  const value = configuration();
  Object.assign(value.modConfig.modOptions, {
    allowClientTimeControls: false,
    postBattleAiAmnestySeconds: 90,
    spawnRateWanderers: 2,
    playerWoundedBattleEntry: false,
    showPlayerNameplates: false,
    kingdomDecisionVoteTimeoutSeconds: 120,
    clansAfterKingdomDestruction: 'KeepClans',
    preferredBattleHosts: ['76561198000000001'],
    pvpBlockLeave: true,
    pvpResponseTimerSeconds: 30,
    maxClansPerKingdom: 7,
    maxClansPerKingdomCountsMercenaries: true,
  });
  const parsed = parseManagedServerConfiguration(value);
  assert.equal(parsed.modConfig.modOptions.clansAfterKingdomDestruction, 'KeepClans');
  assert.equal(parsed.modConfig.modOptions.maxClansPerKingdom, 7);
  assert.equal(parsed.modConfig.modOptions.maxClansPerKingdomCountsMercenaries, true);
  assert.deepEqual(parsed.modConfig.modOptions.preferredBattleHosts, ['76561198000000001']);
  const unknown = configuration();
  Object.assign(unknown.modConfig.modOptions as unknown as Record<string, unknown>, { futureOption: true });
  assert.throws(() => parseManagedServerConfiguration(unknown, messages), { message: messages.shape });
});

test('compares the installed build with catalog availability', () => {
  const option = MANAGED_CONFIG_CATALOG_OPTIONS.find(({ key }) => key === 'maxClansPerKingdom')!;
  assert.equal(isManagedConfigOptionAvailable(option, '0.1.7'), false);
  assert.equal(isManagedConfigOptionAvailable(option, 'v0.1.8'), true);
  assert.equal(isManagedConfigOptionAvailable(option, 'v0.2.0'), true);
  assert.equal(isManagedConfigOptionAvailable(option, null), null);
});

test('preserves Limitless battle sizes and applies the game timer coercion', () => {
  const limitless = configuration();
  limitless.modConfig.modOptions.battleSize = 12000;
  assert.equal(parseManagedServerConfiguration(limitless).modConfig.modOptions.battleSize, 12000);
  const invalid = configuration();
  invalid.modConfig.modOptions.pvpResponseTimerSeconds = 9;
  assert.equal(parseManagedServerConfiguration(invalid).modConfig.modOptions.pvpResponseTimerSeconds, 10);
});

test('accepts the game-coerced kingdom vote timeout values', () => {
  for (const timeout of [0, -1]) {
    const value = configuration();
    value.modConfig.modOptions.kingdomDecisionVoteTimeoutSeconds = timeout;
    assert.equal(parseManagedServerConfiguration(value).modConfig.modOptions.kingdomDecisionVoteTimeoutSeconds, timeout);
  }
});

test('validates every catalog option through the same table used by the editor', () => {
  for (const option of catalog.options) {
    const value = { ...configuration().modConfig.modOptions } as Record<string, unknown>;
    if (option.type === 'enum') value[option.key] = option.values?.[0];
    if (option.type === 'stringList') value[option.key] = ['76561198000000001'];
    assert.doesNotThrow(() => parseManagedServerConfiguration({
      ...configuration(),
      modConfig: { ...configuration().modConfig, modOptions: value },
    }));
  }
});

test('follows catalog mutations for new options, bounds, and enum members', () => {
  const base = { ...configuration().modConfig.modOptions } as Record<string, unknown>;
  const changedBound = structuredClone(catalog.options) as unknown as NonNullable<Parameters<typeof validateCatalogManagedOptions>[2]>;
  const timeout = changedBound.find(option => option.key === 'kingdomDecisionVoteTimeoutSeconds');
  if (!timeout) throw new Error('timeout option missing');
  timeout.min = 10;
  assert.throws(() => validateCatalogManagedOptions({ ...base, kingdomDecisionVoteTimeoutSeconds: 5 }, messages, changedBound), { message: messages.integer });
  const newOption = [...catalog.options, { key: 'futureInteger', type: 'integer', availableSince: '0.1.7', min: 1, max: 3, default: 2 }] as unknown as Parameters<typeof validateCatalogManagedOptions>[2];
  assert.equal((validateCatalogManagedOptions({ ...base, futureInteger: 2 }, messages, newOption) as unknown as Record<string, unknown>).futureInteger, 2);
  const enumChanged = structuredClone(catalog.options) as unknown as NonNullable<Parameters<typeof validateCatalogManagedOptions>[2]>;
  const mode = enumChanged.find(option => option.key === 'clansAfterKingdomDestruction');
  if (!mode) throw new Error('clans option missing');
  mode.values = ['Vanilla', 'KeepClans', 'RetireClans'];
  assert.equal(validateCatalogManagedOptions({ ...base, clansAfterKingdomDestruction: 'RetireClans' }, messages, enumChanged).clansAfterKingdomDestruction, 'RetireClans');
});

test('rejects oversized and malformed catalog structures before parsing settings', () => {
  const oversized = structuredClone(catalog) as { options: unknown[] };
  oversized.options = Array.from({ length: 129 }, () => structuredClone(catalog.options[0]));
  assert.throws(() => validateManagedConfigCatalog(oversized), /malformed/u);
  const malformed = structuredClone(catalog) as { options: Array<Record<string, unknown>> };
  const hosts = malformed.options.find(({ key }) => key === 'preferredBattleHosts')!;
  hosts.itemPattern = '[';
  assert.throws(() => validateManagedConfigCatalog(malformed), /pattern is malformed/u);
});

test('mirrors the released direct numeric bounds while retaining the live Limitless ceiling', () => {
  const released = { battleSize: [200, 1000], playerBattleAiJoinWindowHours: [0, 8760],
    wandererLimit: [0, 1000], playerKingdomClanTierRequired: [0, 6], smithingStaminaRecoveryMultiplier: [0, 100],
    maximumLootersMultiplier: [0, 100], looterPartySizeMultiplier: [0, 100] };
  for (const [key, [min, max]] of Object.entries(released)) {
    const option = MANAGED_CONFIG_CATALOG_OPTIONS.find(candidate => candidate.key === key)!;
    assert.deepEqual(managedConfigNumericBounds(option, 1000), { min, max });
    const value = configuration();
    const input = { ...value.modConfig.modOptions, [key]: key === 'battleSize' ? 199 : max + 1 };
    assert.throws(() => validateCatalogManagedOptions(input, messages));
  }
});

test('enforces Steam ID format without a pattern and rejects fractional timer inputs', () => {
  const options = MANAGED_CONFIG_CATALOG_OPTIONS.map(({ itemPattern, ...option }) => option.key === 'preferredBattleHosts'
    ? option : { ...option, ...(itemPattern === undefined ? {} : { itemPattern }) });
  const defaults = configuration().modConfig.modOptions;
  assert.throws(() => validateCatalogManagedOptions({ ...defaults, preferredBattleHosts: ['abc'] }, messages, options));
  assert.doesNotThrow(() => validateCatalogManagedOptions({ ...defaults, preferredBattleHosts: ['76561198000000001'] }, messages, options));
  assert.throws(() => validateCatalogManagedOptions({ ...defaults, pvpResponseTimerSeconds: 1.5 }, messages), { message: messages.integer });
  assert.equal(validateCatalogManagedOptions({ ...defaults, pvpResponseTimerSeconds: 1 }, messages).pvpResponseTimerSeconds, 10);
});
