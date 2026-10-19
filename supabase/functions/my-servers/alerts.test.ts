import assert from "node:assert/strict";
import test from "node:test";
import { resolveRegionAlertConfig } from "../_shared/region-alerts.ts";
import { REGION_ALERTS } from "./alerts.ts";

test("committed region request alert settings are valid and need only the SMTP_PASS secret", () => {
    assert.equal(resolveRegionAlertConfig(REGION_ALERTS, () => undefined), null);
    const config = resolveRegionAlertConfig(REGION_ALERTS, (name) => (name === "SMTP_PASS" ? "re_test_key" : undefined));
    assert.ok(config !== null);
    assert.deepEqual(config.recipients, ["garrett.luskey@gmail.com"]);
    assert.equal(config.from, "admin@bannerlordcoop.com");
    assert.equal(config.fromName, "Bannerlord Coop");
    assert.deepEqual(config.smtp, { hostname: "smtp.resend.com", port: 465, tls: "implicit", username: "resend", password: "re_test_key" });
});
