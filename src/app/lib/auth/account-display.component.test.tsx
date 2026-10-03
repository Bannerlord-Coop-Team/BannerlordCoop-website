import { expect, it } from "vitest";
import { accountDisplayName } from "./account-display";

it("defaults missing display metadata to English and accepts a caller-supplied fallback", () => {
    for (const user_metadata of [{}, { display_name: " ", full_name: null, name: 42, preferred_username: false, user_name: "\t" }]) {
        expect(accountDisplayName({ user_metadata })).toBe("Your account");
        expect(accountDisplayName({ user_metadata }, "Votre compte")).toBe("Votre compte");
    }
});

it("preserves metadata precedence and trimming with a translated fallback", () => {
    const keys = ["display_name", "full_name", "name", "preferred_username", "user_name"];
    for (let index = 0; index < keys.length; index++) {
        const user_metadata = Object.fromEntries(keys.map((key, position) => [key, position < index ? " \t" : `  ${key} viewer  `]));
        expect(accountDisplayName({ user_metadata }, "Votre compte")).toBe(`${keys[index]} viewer`);
    }
});

it("preserves real display names including the literal English fallback", () => {
    for (const key of ["display_name", "full_name", "name", "preferred_username", "user_name"]) {
        expect(accountDisplayName({ user_metadata: { [key]: "Your account" } }, "Votre compte")).toBe("Your account");
        expect(accountDisplayName({ user_metadata: { [key]: "  玩家 {name}  " } }, "Votre compte")).toBe("玩家 {name}");
    }
});
