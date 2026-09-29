import { DEFAULT_MANAGED_SERVER_CONFIGURATION as defaults, parseManagedServerConfiguration, type ManagedServerConfiguration } from "./managed-server-configuration.ts";

export type ServerSettings = Partial<ManagedServerConfiguration['serverConfig']>;
export interface ModSettings { difficulty?: Partial<ManagedServerConfiguration['modConfig']['difficulty']>; modOptions?: Partial<ManagedServerConfiguration['modConfig']['modOptions']> }
export type ConfigurationPart = 'server' | 'mod' | 'combined';
export type ConfigurationImport = { managedConfig: ManagedServerConfiguration }
  | { configPart: 'server'; settings: ServerSettings }
  | { configPart: 'mod'; settings: ModSettings };

/** Validate the selected patch without substituting defaults for omitted settings. */
export function parseConfigurationImport(value: unknown): ConfigurationImport {
  const input = object(value);
  if (Object.keys(input).length === 1 && Object.hasOwn(input, 'managedConfig')) {
    return { managedConfig: parseManagedServerConfiguration(input.managedConfig) };
  }
  if (Object.keys(input).length !== 2 || !Object.hasOwn(input, 'settings')) throw new Error('Invalid configuration import');
  const settings = object(input.settings);
  if (input.configPart === 'server') {
    requireKeys(settings, defaults.serverConfig);
    parseManagedServerConfiguration({ ...defaults, serverConfig: { ...defaults.serverConfig, ...settings } });
    if (!Object.keys(settings).length) throw new Error('No server settings were found in this file.');
    return { configPart: 'server', settings };
  }
  if (input.configPart !== 'mod') throw new Error('Choose which configuration file to import.');
  requireKeys(settings, defaults.modConfig);
  let count = 0;
  for (const part of ['difficulty', 'modOptions'] as const) {
    if (settings[part] !== undefined) {
      const block = object(settings[part]);
      requireKeys(block, defaults.modConfig[part]);
      count += Object.keys(block).length;
    }
  }
  parseManagedServerConfiguration({ ...defaults, modConfig: {
    difficulty: { ...defaults.modConfig.difficulty, ...object(settings.difficulty ?? {}) },
    modOptions: { ...defaults.modConfig.modOptions, ...object(settings.modOptions ?? {}) },
  } });
  if (!count) throw new Error('No gameplay settings were found in this file.');
  return { configPart: 'mod', settings };
}

export function applyConfigurationImport(current: ManagedServerConfiguration, input: ConfigurationImport): ManagedServerConfiguration {
  if ('managedConfig' in input) return parseManagedServerConfiguration(input.managedConfig);
  return parseManagedServerConfiguration(input.configPart === 'server'
    ? { ...current, serverConfig: { ...current.serverConfig, ...input.settings } }
    : { ...current, modConfig: {
      difficulty: { ...current.modConfig.difficulty, ...input.settings.difficulty },
      modOptions: { ...current.modConfig.modOptions, ...input.settings.modOptions },
    } });
}

// These native settings are intentionally outside the managed configuration contract.
const ignoredServerKeys = ['saveName', 'password', 'port', 'mode', 'devModuleRoot', 'skipLateAi', 'replayHero', 'terrain', 'scene', 'savePath', 'userDir'];
const ignoredModKeys = ['battleSize', 'showPlayerNameplates', 'playerWoundedBattleEntry'];

export function readConfigurationFile(text: string, part: ConfigurationPart): { input: ConfigurationImport; ignoredSettings: string[] } {
  if (new TextEncoder().encode(text).byteLength > 64 * 1024) throw new Error('This file is too large. Choose a configuration file smaller than 64 KB.');
  let raw: Record<string, unknown>;
  try { raw = object(parseCommentedJson(text)); }
  catch { throw new Error('We could not read this file. Choose the original configuration file, not a screenshot or a document.'); }
  const ignoredSettings: string[] = [];
  if (part === 'combined') {
    try { return { input: parseConfigurationImport({ managedConfig: raw }), ignoredSettings }; }
    catch { throw new Error('Choose the settings backup downloaded using Export config on this website. For a game file, select server-config.json or mod-config.json above.'); }
  }
  if (Object.keys(raw).some((key) => ['schemaVersion', 'serverConfig', 'modConfig'].includes(key))) {
    throw new Error('This older combined backup is not supported here. Choose server-config.json or mod-config.json instead.');
  }
  if (part === 'server' && Object.keys(raw).some((key) => ['difficulty', 'modoptions'].includes(key.toLowerCase()))) {
    throw new Error('This looks like mod-config.json. Choose “mod-config.json — gameplay settings” above.');
  }
  if (part === 'mod' && Object.keys(raw).some((key) => key.toLowerCase() === 'autosaveminutes')) {
    throw new Error('This looks like server-config.json. Choose “server-config.json — server settings” above.');
  }
  function pick(source: Record<string, unknown>, supported: object, ignored: string[], nullable = false): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const seen = new Set<string>();
    for (const [key, value] of Object.entries(source)) {
      if (!/^[a-z][a-z0-9]{0,63}$/iu.test(key) || seen.has(key.toLowerCase())) throw new Error('This file contains duplicate or unrecognised setting names. Choose the original configuration file.');
      seen.add(key.toLowerCase());
      const canonical = Object.keys(supported).find((name) => name.toLowerCase() === key.toLowerCase());
      if (canonical === undefined) {
        const skipped = ignored.find((name) => name.toLowerCase() === key.toLowerCase());
        if (skipped === undefined) throw new Error('This file contains settings this website does not recognise. Please contact support with the name of the file.');
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
    if (settings[section] !== undefined) settings[section] = pick(object(settings[section]), defaults.modConfig[section], section === 'modOptions' ? ignoredModKeys : [], true);
  }
  try { return { input: parseConfigurationImport({ configPart: part, settings }), ignoredSettings }; }
  catch { throw new Error('Some settings in this file are missing or are not supported. Choose the original configuration file, or contact support. Nothing has been changed.'); }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Invalid configuration object');
  return value as Record<string, unknown>;
}
function requireKeys(value: Record<string, unknown>, allowed: object) {
  if (Object.keys(value).some((key) => !Object.hasOwn(allowed, key))) throw new Error('Unsupported configuration setting');
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
