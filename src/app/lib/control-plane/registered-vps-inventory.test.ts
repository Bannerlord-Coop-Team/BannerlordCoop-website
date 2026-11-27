import assert from "node:assert/strict";
import { test } from "node:test";
import { ControlPlaneAdminError, decodeControlPlaneAdminResponse } from "./client";
import { readRegisteredVpsInventory } from "./registered-vps-inventory";
import type { HostingAdminVpsInventory } from "./types";

function page(names: string[], nextCursor: string | null, liveDataIncluded = false): HostingAdminVpsInventory {
    return { hosts: names.map(name => ({ name }) as HostingAdminVpsInventory["hosts"][number]),
        nextCursor, liveDataIncluded, controlPlaneHost: null, availableHosts: [] };
}

for (const includeLiveData of [false, true]) {
    test(`negotiates the old VPS request shape in mode ${includeLiveData}`, async () => {
        const calls: unknown[] = [];
        const legacy = page(["old-host"], null, includeLiveData);
        delete legacy.nextCursor;
        const result = await readRegisteredVpsInventory(async input => {
            calls.push(input);
            if (calls.length === 1) throw new ControlPlaneAdminError("invalid_request", "Unsupported page option");
            return legacy;
        }, includeLiveData);
        assert.deepEqual(result, legacy);
        assert.deepEqual(calls, [
            { includeLiveData, includeProviderInventory: false, storedAfter: null },
            includeLiveData ? { includeLiveData: true, includeProviderInventory: false } : { includeLiveData: false },
        ]);
    });
}

test("resumes a fleet scan across consecutive control-plane quota windows", async ({ mock }) => {
    mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
    const hosts = Array.from({ length: 1_929 }, (_, index) => `vps-${index}`);
    const throttled = new Set<string>();
    const throttleError = new ControlPlaneAdminError("rate_limited", "VPS inventory is being refreshed too frequently.", true);
    const accepted: Array<string | null> = [];
    let remaining = 120;
    let windowStarted = Date.now();
    let completed = false;
    const result = readRegisteredVpsInventory(async ({ storedAfter }) => {
        assert.notEqual(storedAfter, undefined);
        storedAfter ??= null;
        if (storedAfter !== null) {
            if (Date.now() - windowStarted >= 60_000) {
                windowStarted = Date.now();
                remaining = 120;
            }
            if (remaining === 0) {
                throttled.add(storedAfter);
                throw throttleError;
            }
            remaining--;
        }
        accepted.push(storedAfter);
        const start = Number(storedAfter ?? 0);
        const next = start + 8;
        return page(hosts.slice(start, next), next < hosts.length ? String(next) : null);
    }, false).finally(() => { completed = true; });
    for (let second = 0; !completed && second < 150; second++) {
        await new Promise<void>(resolve => setImmediate(resolve));
        mock.timers.tick(1_000);
    }

    assert.ok(completed);
    assert.deepEqual((await result).hosts.map(host => host.name), hosts);
    assert.deepEqual(accepted, [null, ...Array.from({ length: 241 }, (_, index) => String((index + 1) * 8))]);
    assert.deepEqual([...throttled], ["968", "1928"]);
    assert.ok(Date.now() >= 120_000);
});

const retryCases = [
    { header: "30", delay: 30_000 },
    { header: "Fri, 27 Nov 2026 12:00:30 GMT", delay: 30_000 },
    { header: "Friday, 27-Nov-26 12:00:30 GMT", delay: 30_000 },
    { header: "Fri Nov 27 12:00:30 2026", delay: 30_000 },
    { header: "Sun Nov  1 12:00:30 2026", delay: 30_000, now: "2026-11-01T12:00:00Z" },
    { header: "Friday, 01-Jan-00 00:00:10 GMT", delay: 30_000, now: "2099-12-31T23:59:40Z" },
    { header: "Sat, 31 Dec 2016 23:59:60 GMT", delay: 30_000, now: "2016-12-31T23:59:30Z" },
    { header: "3600", delay: 60_000 },
    { header: "-30", delay: 1_000 },
    { header: "January 1", delay: 1_000 },
    { header: "Fri, 31 Nov 2026 12:00:30 GMT", delay: 1_000 },
    { header: "Sat, 27 Nov 2026 12:00:30 GMT", delay: 1_000 },
    { header: "Fri Nov 27 12:60:30 2026", delay: 1_000 },
    { header: "Fri, 27 Nov 2026 12:00:30 CST", delay: 1_000 },
];

for (const { header, delay, now = "2026-11-27T12:00:00Z" } of retryCases) {
    test("resumes the same VPS cursor at the bounded Retry-After delay for " + header, async context => {
        const timezone = process.env.TZ;
        process.env.TZ = "America/Chicago";
        context.after(() => {
            if (timezone === undefined) delete process.env.TZ;
            else process.env.TZ = timezone;
        });
        context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.parse(now) });
        const throttle = JSON.stringify({ version: 1, requestId: "throttle", ok: false,
            error: { code: "rate_limited", message: "Try again shortly.", retryable: true } });
        const cursors: (string | null | undefined)[] = [];
        const result = readRegisteredVpsInventory(async ({ storedAfter }) => {
            cursors.push(storedAfter);
            if (storedAfter === null) return page(["first"], "continue");
            if (cursors.length === 2) return decodeControlPlaneAdminResponse<HostingAdminVpsInventory>(
                throttle, "throttle", false, header);
            return page(["last"], null);
        }, false);
        await new Promise<void>(resolve => setImmediate(resolve));
        context.mock.timers.tick(delay - 1);
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.deepEqual(cursors, [null, "continue"]);
        context.mock.timers.tick(1);
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.deepEqual(cursors, [null, "continue", "continue"]);
        assert.deepEqual((await result).hosts.map(host => host.name), ["first", "last"]);
    });
}

test("stops after using the wait budget for one throttled cursor", async ({ mock }) => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const throttle = new ControlPlaneAdminError("rate_limited", "Try again shortly.", true, undefined, undefined, 60_000);
    let reads = 0;
    const rejected = assert.rejects(readRegisteredVpsInventory(async () => {
        reads++;
        throw throttle;
    }, false), throttle);
    for (let retry = 0; retry < 2; retry++) {
        await new Promise<void>(resolve => setImmediate(resolve));
        mock.timers.tick(60_000);
    }
    await rejected;
    assert.equal(reads, 3);
});

test("aborts a throttled scan while it is waiting to retry", async ({ mock }) => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const controller = new AbortController();
    const reason = new Error("Inventory read cancelled");
    const cursors: unknown[] = [];
    const result = readRegisteredVpsInventory(async ({ storedAfter }) => {
        cursors.push(storedAfter);
        if (storedAfter === null) return page(["first"], "continue");
        throw new ControlPlaneAdminError("rate_limited", "Wait to read the next page.", true);
    }, false, controller.signal);
    await new Promise<void>(resolve => setImmediate(resolve));
    controller.abort(reason);
    await assert.rejects(result, reason);
    mock.timers.tick(60_000);
    assert.deepEqual(cursors, [null, "continue"]);
});

test("retains the latest runner target when the terminal page has no sample", async () => {
    const pages = [
        { ...page(["first"], "second", true), runnerTargetSourceCommit: "a".repeat(40) },
        { ...page(["second"], "last", true), runnerTargetSourceCommit: "b".repeat(40) },
        { ...page(["last"], null, true), runnerTargetSourceCommit: null },
    ];
    const result = await readRegisteredVpsInventory(async () => {
        const next = pages.shift();
        assert.ok(next);
        return next;
    }, true);
    assert.deepEqual(result.hosts.map(host => host.name), ["first", "second", "last"]);
    assert.equal(result.runnerTargetSourceCommit, "b".repeat(40));
});

for (const code of ["vps_inventory_changed", "vps_inventory_cursor_expired", "vps_inventory_cursor_invalid"]) {
    test(`restarts a paged VPS scan after ${code}`, async () => {
        const calls: unknown[] = [];
        const result = await readRegisteredVpsInventory(async input => {
            calls.push(input);
            switch (calls.length) {
                case 1: return { ...page(["before"], "before-token"), runnerTargetSourceCommit: "a".repeat(40) };
                case 2: throw new ControlPlaneAdminError(code, "Start a new scan");
                case 3: return page(["after"], "after-token");
                case 4: return page(["last"], null);
                default: throw new Error("Unexpected VPS request");
            }
        }, false);
        assert.deepEqual(result.hosts.map(host => host.name), ["after", "last"]);
        assert.equal(result.nextCursor, null);
        assert.equal(result.runnerTargetSourceCommit, undefined);
        assert.deepEqual(calls, [null, "before-token", null, "after-token"].map(storedAfter =>
            ({ includeLiveData: false, includeProviderInventory: false, storedAfter })));
    });
}

test("stops after a second invalid cursor", async () => {
    const positions: Array<string | null | undefined> = [];
    await assert.rejects(readRegisteredVpsInventory(async ({ storedAfter }) => {
        positions.push(storedAfter);
        if (storedAfter === null) return page(["first"], "continue");
        throw new ControlPlaneAdminError("vps_inventory_cursor_invalid", "Reader restarted");
    }, false), { code: "vps_inventory_cursor_invalid" });
    assert.deepEqual(positions, [null, "continue", null, "continue"]);
});

test("never converts a continuation error into a bulk request", async () => {
    let calls = 0;
    await assert.rejects(readRegisteredVpsInventory(async () => {
        if (++calls === 1) return page(["first"], "continue");
        throw new ControlPlaneAdminError("invalid_request", "Invalid continuation");
    }, false), { code: "invalid_request" });
    assert.equal(calls, 2);
});

test("rejects a missing terminal cursor, duplicate host, or repeated token", async () => {
    const missing = page(["first"], null);
    delete missing.nextCursor;
    const first = page(["first"], "continue");
    for (const second of [missing, page(["first"], null), page(["second"], "continue")]) {
        let calls = 0;
        await assert.rejects(readRegisteredVpsInventory(async () =>
            ++calls === 1 ? first : second, false), { code: "invalid_response" });
        assert.equal(calls, 2);
    }
});
