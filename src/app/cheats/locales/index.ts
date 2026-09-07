import type { CheatsLocale, CheatsMessages } from "@/app/cheats/locale";
import { enMessages } from "@/app/cheats/locales/en";
import { zhCNMessages } from "@/app/cheats/locales/zh-CN";
import zhCNCommands from "@/app/cheats/locales/zh-CN.commands.json";

type CommandCopy = {
    command: string;
    name: string;
    summary: string;
};

export function getCheatsMessages(locale: CheatsLocale): CheatsMessages {
    if (locale === "zh-CN") {
        return {
            ...zhCNMessages,
            commands: zhCNCommands as CheatsMessages["commands"],
        };
    }

    return {
        ...enMessages,
        commands: {},
    };
}

export function localizedCategory(category: string, messages: CheatsMessages) {
    return messages.categories[category] ?? category;
}

export function localizedCommandSummary(
    command: CommandCopy,
    messages: CheatsMessages,
) {
    return messages.commands[command.command]?.summary ?? command.summary;
}
