import { test } from "node:test";
import assert from "node:assert/strict";
import { gatewayErrorMessage } from "./index";

test("membership errors distinguish missing access from Discord failure", () => {
    assert.match(gatewayErrorMessage("discord_membership_required", 403), /Join the Bannerlord Co-op Discord/);
    assert.match(gatewayErrorMessage("discord_membership_required", 502), /could not be checked right now/);
    assert.match(gatewayErrorMessage("discord_membership_required", 500), /Access could not be verified/);
});
