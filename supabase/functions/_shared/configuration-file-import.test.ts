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

// Confirms direct parser validation also receives the nested configuration diagnostics.
test("injects direct import and configuration validation without changing rules", () => {
    assert.throws(() => parseConfigurationImport({}, messages), { message: messages.invalidImport });
    assert.throws(() => parseConfigurationImport({ configPart: "server", settings: { autosaveMinutes: -1 } }, messages), { message: "integer" });
});
