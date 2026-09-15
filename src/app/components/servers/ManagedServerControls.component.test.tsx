import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ManagedServerControls } from "./ManagedServerControls";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";

const { request, beginPolling } = vi.hoisted(() => ({ request: vi.fn(), beginPolling: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/lib/supabase/server", () => ({
    getSupabaseServerClient: async () => ({ auth: {
        getUser: async () => ({ data: { user: { id: "owner" } } }),
        getSession: async () => ({ data: { session: { access_token: "token" } } }),
    } }),
}));
vi.mock("@/app/lib/hosting/my-servers", async (original) => ({
    ...await original<typeof import("@/app/lib/hosting/my-servers")>(),
    requestMyServerOperation: request,
}));
vi.mock("./ManagedServerPollingProvider", () => ({
    useManagedServerPolling: () => ({ session: null, beginPolling, endPolling: vi.fn() }),
}));

it("shows agent confirmation or pending outcomes and tracks their durable operation", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const serverId = "22222222-2222-4222-8222-222222222222";
    const operationId = "55555555-5555-4555-8555-555555555555";
    const updatedAt = "2026-09-02T14:45:07.479Z";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
        for (const code of [null, "operation_timeout", "worker_busy", "operation_in_progress"]) {
            request.mockReset();
            beginPolling.mockClear();
            if (code) request.mockRejectedValue(new MyServersApiError(code, "Not confirmed.", false, operationId));
            else request.mockResolvedValue({ outcome: "succeeded", jobId: operationId, operationId });
            const container = document.createElement("div");
            const root = createRoot(container);
            try {
                await act(async () => root.render(<ManagedServerControls serverId={serverId} displayName="Campaign"
                    accessRole="owner" operationState="stopped" expectedUpdatedAt={updatedAt} />));
                await act(async () => container.querySelector("button")!.click());
                expect(container.textContent).toContain(code === null ? "The agent confirmed" : code === "operation_timeout"
                    ? "It may still complete" : code === "worker_busy" ? "recorded and waiting" : "operation is in progress");
                expect(beginPolling).toHaveBeenCalledWith(serverId, updatedAt, operationId);
                expect(request).toHaveBeenCalledTimes(1);
            } finally { await act(async () => root.unmount()); }
        }
    } finally { log.mockRestore(); }
});
