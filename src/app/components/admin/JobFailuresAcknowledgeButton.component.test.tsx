import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JobFailuresAcknowledgeButton } from "./JobFailuresAcknowledgeButton";

const mocks = vi.hoisted(() => ({
    request: vi.fn(),
    session: vi.fn(),
    refresh: vi.fn(),
}));

vi.mock("@/app/lib/control-plane/client", () => ({ requestControlPlaneAdmin: mocks.request }));
vi.mock("@/app/lib/supabase/client", () => ({
    getSupabaseBrowserClient: () => ({ auth: { getSession: mocks.session } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.session.mockResolvedValue({ data: { session: { access_token: "test-only" } } });
    mocks.request.mockResolvedValue({ acknowledgedCount: 2 });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

async function renderButton(disabled = false) {
    await act(async () => root.render(
        <JobFailuresAcknowledgeButton
            filter={{ state: "failed", action: "backup", failureAcknowledged: false }}
            disabled={disabled}
        />,
    ));
}

function button(text: string) {
    const found = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === text);
    expect(found, text).toBeDefined();
    return found!;
}

async function setReason(value: string) {
    const input = container.querySelector<HTMLInputElement>("#job-failures-acknowledgement-reason")!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

it("opens an inline reason form before issuing any request", async () => {
    await renderButton();
    await act(async () => button("Silence all matching").click());

    expect(container.textContent).toContain("Reason for silencing");
    expect(container.textContent).toContain("Confirm silence");
    expect(mocks.request).not.toHaveBeenCalled();
});

it("validates and submits the exact matching filter from the visible form", async () => {
    await renderButton();
    await act(async () => button("Silence all matching").click());
    await setReason("no");
    await act(async () => container.querySelector("form")!.requestSubmit());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("at least three");
    expect(mocks.request).not.toHaveBeenCalled();

    await setReason("  Reviewed maintenance failures  ");
    await act(async () => container.querySelector("form")!.requestSubmit());

    expect(mocks.request).toHaveBeenCalledOnce();
    expect(mocks.request.mock.calls[0]?.[0]).toMatchObject({
        accessToken: "test-only",
        operation: "acknowledge-job-failures",
        input: {
            filter: { state: "failed", action: "backup", failureAcknowledged: false },
            reason: "Reviewed maintenance failures",
        },
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Silence all matching");
});

it("keeps a failed request visible and retryable without losing its reason", async () => {
    mocks.request.mockRejectedValueOnce(new Error("The acknowledgement failed safely."));
    await renderButton();
    await act(async () => button("Silence all matching").click());
    await setReason("Reviewed failure batch");
    await act(async () => container.querySelector("form")!.requestSubmit());

    expect(container.querySelector('[role="alert"]')?.textContent).toBe("The acknowledgement failed safely.");
    expect(container.querySelector<HTMLInputElement>("#job-failures-acknowledgement-reason")?.value).toBe("Reviewed failure batch");
    expect(button("Confirm silence").hasAttribute("disabled")).toBe(false);
});

it("does not open the form when there are no unacknowledged jobs", async () => {
    await renderButton(true);
    const trigger = button("Silence all matching") as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    await act(async () => trigger.click());
    expect(container.querySelector("form")).toBeNull();
});
