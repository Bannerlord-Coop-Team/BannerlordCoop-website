import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MANAGED_SERVER_CONFIGURATION,
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
