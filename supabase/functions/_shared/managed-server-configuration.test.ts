import assert from 'node:assert/strict';
import test from 'node:test';
import catalog from './managed-config-catalog.json' with { type: 'json' };
import generatedCatalog from './managed-config-catalog-generated.ts';
import {
  DEFAULT_MANAGED_SERVER_CONFIGURATION,
  assertManagedConfigurationAvailableForChannel,
  parseManagedServerConfiguration,
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
  assert.equal(catalog.catalogRevision, '2a9c5212a9ce674ad9961c5d85d595bd9bdaec725117a6082a59701dd864fb2f');
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
  });
  const parsed = parseManagedServerConfiguration(value);
  assert.equal(parsed.modConfig.modOptions.clansAfterKingdomDestruction, 'KeepClans');
  assert.deepEqual(parsed.modConfig.modOptions.preferredBattleHosts, ['76561198000000001']);
  const unknown = configuration();
  Object.assign(unknown.modConfig.modOptions as unknown as Record<string, unknown>, { futureOption: true });
  assert.throws(() => parseManagedServerConfiguration(unknown, messages), { message: messages.shape });
});

test('stable rejects Nightly-only values while Nightly accepts them and game coercions stay rejected', () => {
  const value = configuration();
  value.modConfig.modOptions.clansAfterKingdomDestruction = 'KeepClans';
  assert.throws(() => {
    const parsed = parseManagedServerConfiguration(value);
    assertManagedConfigurationAvailableForChannel(parsed.modConfig.modOptions, 'stable');
  }, /available on Nightly only/u);
  const parsed = parseManagedServerConfiguration(value);
  assert.doesNotThrow(() => assertManagedConfigurationAvailableForChannel(parsed.modConfig.modOptions, 'nightly'));
  const invalid = configuration();
  invalid.modConfig.modOptions.pvpResponseTimerSeconds = 9;
  assert.throws(() => parseManagedServerConfiguration(invalid), { message: 'Managed server configuration integer is invalid' });
});
