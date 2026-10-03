import { DEFAULT_MANAGED_SERVER_CONFIGURATION as defaults, parseManagedServerConfiguration, type ManagedServerConfiguration, type ManagedConfigurationMessages } from "./managed-server-configuration.ts";

export type ConfigurationImportMessages = {
  invalidImport: string;
  noServerSettings: string;
  chooseFile: string;
  noGameplaySettings: string;
  tooLarge: string;
  unreadable: string;
  combinedBackup: string;
  olderBackup: string;
  expectedMod: string;
  expectedServer: string;
  duplicateNames: string;
  unknownSettings: string;
  unsupportedValues: string;
  invalidObject: string;
  unsupportedSetting: string;
  configuration?: ManagedConfigurationMessages;
};

const defaultImportMessages: ConfigurationImportMessages = {
  "invalidImport": "Invalid configuration import",
  "noServerSettings": "No server settings were found in this file.",
  "chooseFile": "Choose which configuration file to import.",
  "noGameplaySettings": "No gameplay settings were found in this file.",
  "tooLarge": "This file is too large. Choose a configuration file smaller than 64 KB.",
  "unreadable": "We could not read this file. Choose the original configuration file, not a screenshot or a document.",
  "combinedBackup": "Choose the settings backup downloaded using Export config on this website. For a game file, select server-config.json or mod-config.json above.",
  "olderBackup": "This older combined backup is not supported here. Choose server-config.json or mod-config.json instead.",
  "expectedMod": "This looks like mod-config.json. Choose “mod-config.json — gameplay settings” above.",
  "expectedServer": "This looks like server-config.json. Choose “server-config.json — server settings” above.",
  "duplicateNames": "This file contains duplicate or unrecognised setting names. Choose the original configuration file.",
  "unknownSettings": "This file contains settings this website does not recognise. Please contact support with the name of the file.",
  "unsupportedValues": "Some settings in this file are missing or are not supported. Choose the original configuration file, or contact support. Nothing has been changed.",
  "invalidObject": "Invalid configuration object",
  "unsupportedSetting": "Unsupported configuration setting"
};

export type ServerSettings = Partial<ManagedServerConfiguration['serverConfig']>;
export interface ModSettings { difficulty?: Partial<ManagedServerConfiguration['modConfig']['difficulty']>; modOptions?: Partial<ManagedServerConfiguration['modConfig']['modOptions']> }
export type ConfigurationPart = 'server' | 'mod' | 'combined';
export type ConfigurationImport = { managedConfig: ManagedServerConfiguration }
  | { configPart: 'server'; settings: ServerSettings }
  | { configPart: 'mod'; settings: ModSettings };

/** Validate the selected patch without substituting defaults for omitted settings. */
export function parseConfigurationImport(value: unknown, messages: ConfigurationImportMessages = defaultImportMessages): ConfigurationImport {
  const input = object(value, messages);
  if (Object.keys(input).length === 1 && Object.hasOwn(input, 'managedConfig')) {
    return { managedConfig: parseManagedServerConfiguration(input.managedConfig, messages.configuration) };
  }
  if (Object.keys(input).length !== 2 || !Object.hasOwn(input, 'settings')) throw new Error(messages.invalidImport);
  const settings = object(input.settings, messages);
  if (input.configPart === 'server') {
    requireKeys(settings, defaults.serverConfig, messages);
    parseManagedServerConfiguration({ ...defaults, serverConfig: { ...defaults.serverConfig, ...settings } }, messages.configuration);
    if (!Object.keys(settings).length) throw new Error(messages.noServerSettings);
    return { configPart: 'server', settings };
  }
  if (input.configPart !== 'mod') throw new Error(messages.chooseFile);
  requireKeys(settings, defaults.modConfig, messages);
  let count = 0;
  for (const part of ['difficulty', 'modOptions'] as const) {
    if (settings[part] !== undefined) {
      const block = object(settings[part], messages);
      requireKeys(block, defaults.modConfig[part], messages);
      count += Object.keys(block).length;
    }
  }
  parseManagedServerConfiguration({ ...defaults, modConfig: {
    difficulty: { ...defaults.modConfig.difficulty, ...object(settings.difficulty ?? {}, messages) },
    modOptions: { ...defaults.modConfig.modOptions, ...object(settings.modOptions ?? {}, messages) },
  } }, messages.configuration);
  if (!count) throw new Error(messages.noGameplaySettings);
  return { configPart: 'mod', settings };
}

// Applies only the selected import while retaining omitted values and injected diagnostics.
export function applyConfigurationImport(current: ManagedServerConfiguration, input: ConfigurationImport, messages: ConfigurationImportMessages = defaultImportMessages): ManagedServerConfiguration {
  if ('managedConfig' in input) return parseManagedServerConfiguration(input.managedConfig, messages.configuration);
  return parseManagedServerConfiguration(input.configPart === 'server'
    ? { ...current, serverConfig: { ...current.serverConfig, ...input.settings } }
    : { ...current, modConfig: {
      difficulty: { ...current.modConfig.difficulty, ...input.settings.difficulty },
      modOptions: { ...current.modConfig.modOptions, ...input.settings.modOptions },
    } }, messages.configuration);
}

// These native settings are intentionally outside the managed configuration contract.
const ignoredServerKeys = ['saveName', 'password', 'port', 'mode', 'devModuleRoot', 'skipLateAi', 'replayHero', 'terrain', 'scene', 'savePath', 'userDir'];
const ignoredModKeys = ['battleSize', 'showPlayerNameplates', 'playerWoundedBattleEntry'];

// Reads a native or exported configuration with detailed injected diagnostics and private ignored values.
export function readConfigurationFile(text: string, part: ConfigurationPart, messages: ConfigurationImportMessages = defaultImportMessages): { input: ConfigurationImport; ignoredSettings: string[] } {
  if (new TextEncoder().encode(text).byteLength > 64 * 1024) throw new Error(messages.tooLarge);
  let raw: Record<string, unknown>;
  try { raw = object(parseCommentedJson(text), messages); }
  catch { throw new Error(messages.unreadable); }
  const ignoredSettings: string[] = [];
  if (part === 'combined') {
    try { return { input: parseConfigurationImport({ managedConfig: raw }, messages), ignoredSettings }; }
    catch { throw new Error(messages.combinedBackup); }
  }
  if (Object.keys(raw).some((key) => ['schemaVersion', 'serverConfig', 'modConfig'].includes(key))) {
    throw new Error(messages.olderBackup);
  }
  if (part === 'server' && Object.keys(raw).some((key) => ['difficulty', 'modoptions'].includes(key.toLowerCase()))) {
    throw new Error(messages.expectedMod);
  }
  if (part === 'mod' && Object.keys(raw).some((key) => key.toLowerCase() === 'autosaveminutes')) {
    throw new Error(messages.expectedServer);
  }
  // Selects supported names without exposing ignored setting values.
  function pick(source: Record<string, unknown>, supported: object, ignored: string[], nullable = false): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const seen = new Set<string>();
    for (const [key, value] of Object.entries(source)) {
      if (!/^[a-z][a-z0-9]{0,63}$/iu.test(key) || seen.has(key.toLowerCase())) throw new Error(messages.duplicateNames);
      seen.add(key.toLowerCase());
      const canonical = Object.keys(supported).find((name) => name.toLowerCase() === key.toLowerCase());
      if (canonical === undefined) {
        const skipped = ignored.find((name) => name.toLowerCase() === key.toLowerCase());
        if (skipped === undefined) throw new Error(messages.unknownSettings);
        ignoredSettings.push(skipped); // Never include an ignored value (which may be a password/path).
      } else if (!(nullable && value === null)) {
        const expected = (supported as Record<string, unknown>)[canonical];
        result[canonical] = typeof expected === 'number' && typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      }
    }
    return result;
  }
  const settings = part === 'server' ? pick(raw, defaults.serverConfig, ignoredServerKeys) : pick(raw, defaults.modConfig, []);
  if (part === 'mod') for (const section of ['difficulty', 'modOptions'] as const) {
    if (settings[section] !== undefined) settings[section] = pick(object(settings[section], messages), defaults.modConfig[section], section === 'modOptions' ? ignoredModKeys : [], true);
  }
  try { return { input: parseConfigurationImport({ configPart: part, settings }, messages), ignoredSettings }; }
  catch { throw new Error(messages.unsupportedValues); }
}

// Validates plain configuration objects with caller-supplied presentation.
function object(value: unknown, messages: ConfigurationImportMessages = defaultImportMessages): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(messages.invalidObject);
  return value as Record<string, unknown>;
}
// Rejects unsupported configuration keys without changing the schema.
function requireKeys(value: Record<string, unknown>, allowed: object, messages: ConfigurationImportMessages = defaultImportMessages) {
  if (Object.keys(value).some((key) => !Object.hasOwn(allowed, key))) throw new Error(messages.unsupportedSetting);
}

/** Native files allow BOM, comments and trailing commas; strings remain untouched. */
function parseCommentedJson(text: string): unknown {
  const chars = Array.from(text.replace(/^\uFEFF/u, ''));
  let inString = false;
  let escaped = false;
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '/' && chars[i + 1] === '/') {
      while (i < chars.length && chars[i] !== '\n' && chars[i] !== '\r') chars[i++] = ' ';
    } else if (char === '/' && chars[i + 1] === '*') {
      chars[i++] = ' '; chars[i] = ' ';
      let closed = false;
      while (++i < chars.length) {
        if (chars[i] === '*' && chars[i + 1] === '/') { chars[i++] = ' '; chars[i] = ' '; closed = true; break; }
        chars[i] = ' ';
      }
      if (!closed) throw new Error('Unclosed comment');
    }
  }
  inString = false; escaped = false;
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === ',') {
      let next = i + 1;
      while (next < chars.length && /\s/u.test(chars[next] ?? '')) next++;
      if (chars[next] === '}' || chars[next] === ']') chars[i] = ' ';
    }
  }
  return JSON.parse(chars.join('')) as unknown;
}
