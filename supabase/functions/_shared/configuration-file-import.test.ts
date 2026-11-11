import assert from "node:assert/strict";
import test from "node:test";
import { applyConfigurationImport, parseConfigurationImport, readConfigurationFile, type ConfigurationImportMessages } from "./configuration-file-import.ts";
import { DEFAULT_MANAGED_SERVER_CONFIGURATION as defaults } from "./managed-server-configuration.ts";

const messages: ConfigurationImportMessages = {
    invalidImport: "localized import", noServerSettings: "localized empty server", chooseFile: "localized selection",
    noGameplaySettings: "localized empty gameplay", tooLarge: "localized size", unreadable: "localized unreadable",
    combinedBackup: "localized combined", olderBackup: "localized older", expectedMod: "localized mod", expectedServer: "localized server",
    duplicateNames: "localized duplicate", unknownSettings: "localized unknown", unsupportedValues: "localized unsupported",
    invalidObject: "localized object", unsupportedSetting: "localized setting",
    configuration: { root: "root", version: "version", shape: "shape", boolean: "boolean", integer: "integer", number: "number", choice: "choice" },
};

// Exercises distinct file rejection paths with detailed default and injected diagnostics.
for (const [text, part, key, english] of [
    ["not json", "server", "unreadable", "We could not read this file."],
    ['{"difficulty":{}}', "server", "expectedMod", "This looks like mod-config.json."],
    ['{"autosaveMinutes":5,"AUTOSAVEMINUTES":6}', "server", "duplicateNames", "This file contains duplicate"],
    ['{"unknown":true}', "server", "unknownSettings", "This file contains settings this website does not recognise."],
    ['{"autosaveMinutes":-1}', "server", "unsupportedValues", "Some settings in this file are missing"],
] as const) {
    test(`preserves and injects the ${key} diagnostic`, () => {
        assert.throws(() => readConfigurationFile(text, part), (error: Error) => error.message.startsWith(english));
        assert.throws(() => readConfigurationFile(text, part, messages), { message: messages[key] });
    });
}

// Keeps imported values, omitted settings and ignored-value privacy independent of presentation.
test("localized import preserves the original parsed result and private ignored values", () => {
    const text = '{"AutoSaveMinutes":"10", "password":"private-value", "saveName":"private-path"}';
    const original = readConfigurationFile(text, "server");
    const localized = readConfigurationFile(text, "server", messages);
    assert.deepEqual(localized, original);
    assert.deepEqual(localized.ignoredSettings, ["password", "saveName"]);
    assert.doesNotMatch(JSON.stringify(localized), /private-value|private-path/);
    assert.deepEqual(applyConfigurationImport(defaults, localized.input, messages), applyConfigurationImport(defaults, original.input));
    assert.equal(applyConfigurationImport(defaults, localized.input, messages).serverConfig.autosaveMinutes, 10);
});

test("imports native Coop settings and reports the legacy network block as ignored", () => {
    const parsed = readConfigurationFile(`{
        "voice": { "mapFullVolumeDistance": 5, "mapMaximumDistance": 20, "sceneFullVolumeDistance": 10, "sceneMaximumDistance": 50 },
        "network": { "movementIncomingMiBPerSecond": 1, "movementOutgoingMiBPerSecond": 1 },
        "modOptions": {
            "voiceEnabled": false,
            "blockAiWarDeclarationsOnOfflinePlayers": true,
            "ensureUnaffiliatedWanderers": false,
            "coopClansEnabled": false,
            "enablePlayerExecutions": true
        }
    }`, "mod");
    assert.deepEqual(parsed.ignoredSettings, ["network"]);
    const updated = applyConfigurationImport(defaults, parsed.input);
    assert.equal(updated.modConfig.voice.sceneMaximumDistance, 50);
    assert.deepEqual({
        voiceEnabled: updated.modConfig.modOptions.voiceEnabled,
        blockAiWarDeclarationsOnOfflinePlayers: updated.modConfig.modOptions.blockAiWarDeclarationsOnOfflinePlayers,
        ensureUnaffiliatedWanderers: updated.modConfig.modOptions.ensureUnaffiliatedWanderers,
        coopClansEnabled: updated.modConfig.modOptions.coopClansEnabled,
        enablePlayerExecutions: updated.modConfig.modOptions.enablePlayerExecutions,
    }, {
        voiceEnabled: false,
        blockAiWarDeclarationsOnOfflinePlayers: true,
        ensureUnaffiliatedWanderers: false,
        coopClansEnabled: false,
        enablePlayerExecutions: true,
    });
});

test("names unknown native settings in the import error", () => {
    assert.throws(() => readConfigurationFile('{"modOptions":{"futureOption":true}}', "mod"), /modOptions\.futureOption/u);
});

// Confirms direct parser validation also receives the nested configuration diagnostics.
test("injects direct import and configuration validation without changing rules", () => {
    assert.throws(() => parseConfigurationImport({}, messages), { message: messages.invalidImport });
    assert.throws(() => parseConfigurationImport({ configPart: "server", settings: { autosaveMinutes: -1 } }, messages), { message: "integer" });
});

test("imports the native battle size and still reports other unmanaged mod options", () => {
    const parsed = readConfigurationFile('{"modOptions":{"battleSize":"600","showPlayerNameplates":true}}', "mod");
    assert.deepEqual(parsed.ignoredSettings, ["showPlayerNameplates"]);
    assert.equal(applyConfigurationImport(defaults, parsed.input).modConfig.modOptions.battleSize, 600);
    assert.throws(() => readConfigurationFile('{"modOptions":{"battleSize":12001}}', "mod", messages), { message: messages.unsupportedValues });
});

// Builds a configuration whose War Sails mode is `warSails`.
function withWarSails(warSails: boolean) {
    return { ...defaults, modConfig: { ...defaults.modConfig, modOptions: { ...defaults.modConfig.modOptions, warSails } } };
}

test("a native War Sails setting is reported as ignored and never imported", () => {
    const parsed = readConfigurationFile('{"modOptions":{"battleSize":600,"WarSails":true}}', "mod");
    assert.deepEqual(parsed.ignoredSettings, ["warSails"]);
    assert.deepEqual(parsed.input, { configPart: "mod", settings: { modOptions: { battleSize: 600 } } });
    assert.equal(applyConfigurationImport(withWarSails(true), parsed.input).modConfig.modOptions.warSails, true);
    assert.equal(applyConfigurationImport(defaults, parsed.input).modConfig.modOptions.warSails, false);
});

test("a backup's War Sails setting is reported as ignored and every import keeps the server's mode", () => {
    const parsed = readConfigurationFile(JSON.stringify(withWarSails(true)), "combined");
    assert.deepEqual(parsed.ignoredSettings, ["warSails"]);
    assert.equal(applyConfigurationImport(defaults, parsed.input).modConfig.modOptions.warSails, false);
    assert.equal(applyConfigurationImport(withWarSails(true), { managedConfig: defaults }).modConfig.modOptions.warSails, true);
    const patch = parseConfigurationImport({ configPart: "mod", settings: { modOptions: { warSails: true } } });
    assert.equal(applyConfigurationImport(defaults, patch).modConfig.modOptions.warSails, false);
    const older = structuredClone(defaults) as { modConfig: { modOptions: Partial<typeof defaults.modConfig.modOptions> } };
    delete older.modConfig.modOptions.warSails;
    assert.deepEqual(readConfigurationFile(JSON.stringify(older), "combined").ignoredSettings, []);
});
