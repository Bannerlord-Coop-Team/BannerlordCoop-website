import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ForceUpdateServerCard } from "./ForceUpdateServerCard";
import { adminActionOptionValue } from "@/app/lib/control-plane/presentation";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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

it("does not offer submission when there is no eligible server", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<ForceUpdateServerCard serverField={{
        name: "serverId", label: "Server", kind: "server", required: true, options: [],
    }} />);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
});
