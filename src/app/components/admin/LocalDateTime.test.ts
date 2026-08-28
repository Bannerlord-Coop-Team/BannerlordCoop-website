import assert from "node:assert/strict";
import test from "node:test";
import { formatLocalDateTime } from "./LocalDateTime";

test("formats provider timestamps in the selected browser timezone", () => {
    const formatted = formatLocalDateTime("2026-08-28T02:10:00.000Z", {
        locale: "en-US",
        timeZone: "America/Chicago",
    });

    assert.match(formatted, /Aug 27, 2026/);
    assert.match(formatted, /9:10 PM/);
});
