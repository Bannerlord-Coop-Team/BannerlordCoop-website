import { describe, expect, it, vi } from "vitest";
import { translateCheat } from "./translation";

describe("translateCheat", () => {
    it("returns the localized catalog entry when it exists", () => {
        const translate = vi.fn(() => "Translated");
        expect(translateCheat(translate, "command.example.summary", "Source")).toBe("Translated");
        expect(translate).toHaveBeenCalledWith("command.example.summary");
    });

    it("returns source catalog text when the locale entry is missing", () => {
        const translate = vi.fn(() => { throw new Error("Missing translation"); });
        expect(translateCheat(translate, "command.example.summary", "Source")).toBe("Source");
    });
});
