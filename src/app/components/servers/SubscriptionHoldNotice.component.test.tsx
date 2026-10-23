import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SubscriptionHoldNotice } from "./SubscriptionHoldNotice";

it("warns of permanent removal with the exact UTC deadline and rescue steps", () => {
    const html = renderToStaticMarkup(<SubscriptionHoldNotice isOwner={true} hold={{ state: "held", reason: "subscription-funding-lapsed", removalDueAt: "2026-10-25T00:50:42.044Z", canExportSave: true }} />);
    expect(html).toContain("PERMANENTLY removed");
    expect(html).toContain("Sun, 25 Oct 2026 00:50:42 GMT");
    expect(html).toContain("Export save");
    expect(html).not.toContain("recover after");
});
it("does not offer rescue while removal is pending and hides a cleared hold", () => {
    expect(renderToStaticMarkup(<SubscriptionHoldNotice isOwner={true} hold={null} />)).toBe("");
    const html = renderToStaticMarkup(<SubscriptionHoldNotice isOwner={true} hold={{ state: "removal-pending", reason: "subscription-funding-lapsed", removalDueAt: "2026-10-25T00:50:42.044Z", canExportSave: false }} />);
    expect(html).toContain("Removal is pending");
    expect(html).not.toContain("Export save");
});

it("directs non-owners to the owner rather than their own funding account", () => {
    const html = renderToStaticMarkup(<SubscriptionHoldNotice isOwner={false} hold={{ state: "held", reason: "subscription-funding-lapsed", removalDueAt: "2026-10-25T00:50:42.044Z", canExportSave: false }} />);
    expect(html).toContain("The owner must restore qualifying funding");
    expect(html).not.toContain('href="/account"');
    expect(html).not.toContain("Export save");
    expect(html).toContain("PERMANENTLY removed");
});
