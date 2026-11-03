import assert from "node:assert/strict";
import test from "node:test";
import { isLegacyEmptyServerLog } from "./server-log.ts";

const emptyDescriptor = {
  fileName: "Coop_server.log",
  contentEncoding: "gzip",
  compressedLength: 0,
  uncompressedLength: 0,
};

test("drops the zero-length descriptor and empty part older mods send for an empty log", () => {
  assert.equal(isLegacyEmptyServerLog(emptyDescriptor, { size: 0 }), true);
  assert.equal(isLegacyEmptyServerLog(emptyDescriptor, null), true);
});

test("keeps validating a server log that has content", () => {
  assert.equal(
    isLegacyEmptyServerLog(
      { ...emptyDescriptor, compressedLength: 42, uncompressedLength: 100 },
      { size: 42 },
    ),
    false,
  );
  assert.equal(isLegacyEmptyServerLog(emptyDescriptor, { size: 42 }), false);
  assert.equal(
    isLegacyEmptyServerLog({ ...emptyDescriptor, uncompressedLength: 100 }, { size: 0 }),
    false,
  );
});

test("leaves missing or malformed descriptors to the payload validator", () => {
  assert.equal(isLegacyEmptyServerLog(null, null), false);
  assert.equal(isLegacyEmptyServerLog(undefined, { size: 0 }), false);
  assert.equal(isLegacyEmptyServerLog("serverLog", { size: 0 }), false);
  assert.equal(
    isLegacyEmptyServerLog({ ...emptyDescriptor, compressedLength: undefined }, { size: 0 }),
    false,
  );
  assert.equal(
    isLegacyEmptyServerLog({ ...emptyDescriptor, compressedLength: "0" }, { size: 0 }),
    false,
  );
});
