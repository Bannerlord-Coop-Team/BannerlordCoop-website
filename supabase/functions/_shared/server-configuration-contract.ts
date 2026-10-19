import { DEFAULT_MANAGED_SERVER_CONFIGURATION as defaults, parseManagedServerConfiguration, type ManagedServerConfiguration } from "./managed-server-configuration.ts";
import { requireUuid } from "./server-file-contract.ts";

// Mirrors the control plane's direct runner configuration contract
// (`src/hosting/runner/contracts/direct-configuration.ts`): one native file at a time,
// guarded by the SHA-256 revision of the file that was read.
export const RUNNER_CONFIGURATION_PARTS = ["server", "mod"] as const;
export type RunnerConfigurationPart = (typeof RUNNER_CONFIGURATION_PARTS)[number];
export type RunnerServerSettings = ManagedServerConfiguration["serverConfig"];
export type RunnerModSettings = ManagedServerConfiguration["modConfig"];

export type RunnerConfigurationFile =
  | { configPart: "server"; revision: string; settings: RunnerServerSettings }
  | { configPart: "mod"; revision: string; settings: RunnerModSettings };

export type RunnerConfigurationMutation = { serverId: string; expectedRevision: string } & (
  | { configPart: "server"; settings: RunnerServerSettings }
  | { configPart: "mod"; settings: RunnerModSettings }
);

const REVISION = /^[a-f0-9]{64}$/u;

export function requireRunnerConfigurationPart(value: unknown): asserts value is RunnerConfigurationPart {
  if (value !== "server" && value !== "mod") throw new Error("Invalid configuration part");
}

export function requireRunnerConfigurationRevision(value: unknown): asserts value is string {
  if (typeof value !== "string" || !REVISION.test(value)) throw new Error("Invalid configuration revision");
}

/** Validates one file's complete supported settings without substituting defaults for missing values. */
export function parseRunnerConfigurationSettings(part: "server", value: unknown): RunnerServerSettings;
export function parseRunnerConfigurationSettings(part: "mod", value: unknown): RunnerModSettings;
export function parseRunnerConfigurationSettings(part: RunnerConfigurationPart, value: unknown): RunnerServerSettings | RunnerModSettings;
export function parseRunnerConfigurationSettings(part: RunnerConfigurationPart, value: unknown): RunnerServerSettings | RunnerModSettings {
  const parsed = parseManagedServerConfiguration(part === "server"
    ? { ...defaults, serverConfig: value }
    : { ...defaults, modConfig: value });
  return part === "server" ? parsed.serverConfig : parsed.modConfig;
}

export function parseRunnerConfigurationFile(value: unknown): RunnerConfigurationFile {
  if (!record(value)) throw new Error("Invalid configuration file");
  exact(value, ["configPart", "revision", "settings"]);
  requireRunnerConfigurationPart(value.configPart);
  requireRunnerConfigurationRevision(value.revision);
  return value.configPart === "server"
    ? { configPart: "server", revision: value.revision, settings: parseRunnerConfigurationSettings("server", value.settings) }
    : { configPart: "mod", revision: value.revision, settings: parseRunnerConfigurationSettings("mod", value.settings) };
}

export function parseRunnerConfigurationMutation(value: unknown): RunnerConfigurationMutation {
  if (!record(value)) throw new Error("Invalid configuration request");
  exact(value, ["serverId", "configPart", "expectedRevision", "settings"]);
  requireUuid(value.serverId);
  requireRunnerConfigurationPart(value.configPart);
  requireRunnerConfigurationRevision(value.expectedRevision);
  const common = { serverId: value.serverId, expectedRevision: value.expectedRevision };
  return value.configPart === "server"
    ? { ...common, configPart: "server", settings: parseRunnerConfigurationSettings("server", value.settings) }
    : { ...common, configPart: "mod", settings: parseRunnerConfigurationSettings("mod", value.settings) };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new Error("Invalid configuration request fields");
}
