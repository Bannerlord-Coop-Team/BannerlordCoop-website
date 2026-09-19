import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ForceUpdateServerCard } from "./ForceUpdateServerCard";
import { adminActionOptionValue } from "@/app/lib/control-plane/presentation";

const { request, refresh } = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/lib/control-plane/stale-request", () => ({ requestControlPlaneAdminWithRefresh: request }));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: {
    getSession: async () => ({ data: { session: { access_token: "test-only" } } }),
} }) }));

it("offers only the server generation and required audit reason with downtime warnings", () => {
    const option = { label: "Alpha · Stable", value: "server-a", updatedAt: "2026-09-18T12:00:00Z" };
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<ForceUpdateServerCard serverField={{
        name: "serverId", label: "Server", kind: "server", required: true,
        options: [option], defaultValue: adminActionOptionValue("server", option),
    }} />);
    expect(container.textContent).toContain("Force Update");
    expect(container.textContent).toContain("immutable digest");
    expect(container.textContent).toContain("even when that digest is already installed");
    expect(container.textContent).toContain("Players will be disconnected");
    expect(container.textContent).toContain("rollback safeguards");
    expect([...container.querySelectorAll("[name]")].map((field) => field.getAttribute("name"))).toEqual(["serverId", "reason"]);
    expect(container.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')?.required).toBe(true);
    expect(JSON.parse(container.querySelector<HTMLSelectElement>('select[name="serverId"]')!.value)).toEqual({ id: option.value, updatedAt: option.updatedAt });
});

it("confirms each intentional action, sends only the proposed contract, and shows existing job progress without retrying errors", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    request.mockReset(); refresh.mockReset();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const serverId = "aaaaaaaa-1111-4111-8111-111111111111";
    const jobId = "bbbbbbbb-2222-4222-8222-222222222222";
    const option = { label: "Alpha", value: serverId, updatedAt: "2026-09-18T12:00:00Z" };
    try {
        await act(async () => root.render(<ForceUpdateServerCard serverField={{
            name: "serverId", label: "Server", kind: "server", required: true,
            options: [option], defaultValue: adminActionOptionValue("server", option),
        }} />));
        const form = container.querySelector("form")!;
        const reason = container.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!;
        reason.value = "Install rebuilt channel image";
        await act(async () => form.requestSubmit());
        expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Force Update"));
        expect(request).not.toHaveBeenCalled();
        confirm.mockReturnValue(true);
        request.mockResolvedValue({ outcome: "existing", job: { jobId, serverId, action: "update", state: "queued" } });
        await act(async () => form.requestSubmit());
        expect(request.mock.calls[0][0]).toEqual({
            accessToken: "test-only", requestId: expect.any(String), operation: "force-update-server",
            input: { serverId, expectedUpdatedAt: option.updatedAt, reason: "Install rebuilt channel image" },
        });
        expect(container.textContent).toContain("queued");
        expect(container.querySelector(`a[href="/admin/control-plane?view=jobs&serverId=${serverId}"]`)?.textContent).toBe("Track job progress");
        expect(refresh).toHaveBeenCalledOnce();
        reason.value = "Install rebuilt channel image";
        request.mockRejectedValueOnce(new Error("Registry unavailable"));
        await act(async () => form.requestSubmit());
        expect(request).toHaveBeenCalledTimes(2);
        expect(request.mock.calls[1][0].requestId).not.toBe(request.mock.calls[0][0].requestId);
        expect(container.querySelector('[role="alert"]')?.textContent).toContain("Registry unavailable");
        expect(refresh).toHaveBeenCalledOnce();
    } finally {
        await act(async () => root.unmount());
        container.remove(); confirm.mockRestore();
    }
});

it("does not offer submission when there is no eligible server", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<ForceUpdateServerCard serverField={{
        name: "serverId", label: "Server", kind: "server", required: true, options: [],
    }} />);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
});
