import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SponsorClaimForm, type ClaimFormState } from "./SponsorClaimForm";
import { SponsorPortal } from "./SponsorPortal";
import type { CreateCodeState, RemoveSeatState } from "./SponsorPortalForms";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** Mounts a component in a fresh act-enabled container. */
async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(element));
    return container;
}

/** Submits a form the way a click on its submit button would. */
async function submit(form: HTMLFormElement): Promise<void> {
    await act(async () => form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
}

afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    container?.remove();
    root = null;
    container = null;
});

it("claim form submits the sponsor code and shows the mapped error inline", async () => {
    const action = vi.fn(async (_state: ClaimFormState, form: FormData): Promise<ClaimFormState> => {
        expect(form.get("sponsor_code")).toBe("AB2C-DEF3-GH45");
        return { error: "That sponsor code is not valid." };
    });
    const view = await mount(<SponsorClaimForm action={action} />);
    const input = view.querySelector<HTMLInputElement>("#sponsor-code")!;
    expect(input.name).toBe("sponsor_code");
    expect(input.required).toBe(true);
    expect(input.maxLength).toBe(128);
    expect(view.querySelector('label[for="sponsor-code"]')?.textContent).toContain("sponsor code");
    expect(view.querySelector('[role="alert"]')).toBeNull();

    input.value = "AB2C-DEF3-GH45";
    await submit(view.querySelector("form")!);

    expect(action).toHaveBeenCalledTimes(1);
    expect(view.querySelector('[role="alert"]')?.textContent).toBe("That sponsor code is not valid.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
});

it("portal lists seats with a count, and removes a seat by its Discord id", async () => {
    const createCode = vi.fn(async (): Promise<CreateCodeState> => ({ code: null, error: null }));
    const removeSeat = vi.fn(async (_state: RemoveSeatState, form: FormData): Promise<RemoveSeatState> => {
        expect(form.get("discord_user_id")).toBe("223456789012345678");
        return { error: "That sponsored account could not be removed. Reload the page and try again." };
    });
    const view = await mount(
        <SponsorPortal
            data={{ seats: [
                { discordUserId: "123456789012345678", createdAt: new Date("2026-11-01T10:00:00Z") },
                { discordUserId: "223456789012345678", createdAt: null },
            ] }}
            createCode={createCode}
            removeSeat={removeSeat}
        />,
    );
    expect(view.querySelector('[aria-label="2 of 10 seats used"]')).not.toBeNull();
    expect(view.textContent).toContain("8 open");
    expect(view.textContent).toContain("Create a new code");
    expect(view.textContent).toContain("Added Nov 1, 2026");
    const seats = [...view.querySelectorAll("li")];
    expect(seats.map((seat) => seat.querySelector("code")?.textContent)).toEqual(["123456789012345678", "223456789012345678"]);

    await submit(seats[1]!.querySelector("form")!);

    expect(removeSeat).toHaveBeenCalledTimes(1);
    expect(createCode).not.toHaveBeenCalled();
    expect(seats[1]!.querySelector('[role="alert"]')?.textContent).toContain("could not be removed");
    expect(seats[0]!.querySelector('[role="alert"]')).toBeNull();
});

it("portal creates a sponsor code and shows it once, or the error", async () => {
    const createCode = vi.fn()
        .mockResolvedValueOnce({ code: "AB2C-DEF3-GH45", error: null })
        .mockResolvedValueOnce({ code: null, error: "A Staff, Tester, Patreon, Boosty, or Afdian role is required." });
    const view = await mount(<SponsorPortal data={{ seats: [] }} createCode={createCode} removeSeat={vi.fn()} />);
    expect(view.textContent).toContain("No seats claimed yet.");
    expect(view.textContent).toContain("10 open");
    const form = view.querySelector("form")!;
    expect(form.textContent).toContain("Create sponsor code");

    await submit(form);
    expect(view.querySelector('[role="status"]')?.textContent).toContain("AB2C-DEF3-GH45");
    expect(view.textContent).toContain("until your 10 seats are full");

    await submit(form);
    expect(view.querySelector('[role="status"]')).toBeNull();
    expect(view.querySelector('[role="alert"]')?.textContent).toBe("A Staff, Tester, Patreon, Boosty, or Afdian role is required.");
});
