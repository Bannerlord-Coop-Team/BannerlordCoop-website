import { requestMyServersApi } from "./my-servers";
import {
    parseRunnerConfigurationFile,
    type RunnerConfigurationFile,
    type RunnerConfigurationMutation,
    type RunnerConfigurationPart,
} from "../../../../supabase/functions/_shared/server-configuration-contract";

/** Reads one native runner configuration file through the owner Edge Function. */
export async function getMyServerConfiguration(accessToken: string, serverId: string, configPart: RunnerConfigurationPart): Promise<RunnerConfigurationFile> {
    const file = parseRunnerConfigurationFile(await requestMyServersApi(accessToken, {
        method: "GET",
        configureEndpoint(url) {
            url.searchParams.set("resource", "config");
            url.searchParams.set("serverId", serverId);
            url.searchParams.set("configPart", configPart);
        },
    }));
    if (file.configPart !== configPart) throw new Error("Configuration response belongs to another file");
    return file;
}

/** Replaces one file's supported settings; the durable request ID makes retries replay-safe. */
export async function saveMyServerConfiguration(accessToken: string, requestId: string, input: RunnerConfigurationMutation): Promise<RunnerConfigurationFile> {
    const file = parseRunnerConfigurationFile(await requestMyServersApi(accessToken, {
        method: "POST", body: JSON.stringify({ action: "save-config", ...input }), requestId,
    }));
    if (file.configPart !== input.configPart) throw new Error("Configuration response belongs to another file");
    return file;
}
