import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SubscriptionHoldNotice } from "./SubscriptionHoldNotice";

it("warns of permanent removal with the exact UTC deadline and rescue steps", () => {
    const html = renderToStaticMarkup(<SubscriptionHoldNotice hold={{ state: "held", reason: "subscription-funding-lapsed", removalDueAt: "2026-10-25T00:50:42.044Z", canExportSave: true }} />);
    expect(html).toContain("PERMANENTLY removed");
    expect(html).toContain("Sun, 25 Oct 2026 00:50:42 GMT");
    expect(html).toContain("Export save");
    expect(html).not.toContain("recover after");
});
it("does not offer rescue while removal is pending and hides a cleared hold", () => {
    expect(renderToStaticMarkup(<SubscriptionHoldNotice hold={null} />)).toBe("");
    const html = renderToStaticMarkup(<SubscriptionHoldNotice hold={{ state: "removal-pending", reason: "subscription-funding-lapsed", removalDueAt: "2026-10-25T00:50:42.044Z", canExportSave: false }} />);
    expect(html).toContain("Removal is pending");
    expect(html).not.toContain("Export save");
});
