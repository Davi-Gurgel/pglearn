import assert from "node:assert/strict";
import { test } from "node:test";
import { toText } from "../src/backend/query-cell.ts";

test("preserves null, bigint precision, nested values and timestamps", () => {
  assert.equal(toText(null), null);
  assert.equal(toText(9007199254740993n), "9007199254740993");
  assert.equal(
    toText({ values: [9007199254740993n, null] }),
    '{"values":["9007199254740993",null]}',
  );
  assert.equal(toText(new Date("2026-01-01T00:00:00Z")), "2026-01-01T00:00:00.000Z");
});

test("does not silently turn unsupported timestamps into NULL", () => {
  assert.throws(() => toText(new Date(NaN)), /Cast the timestamp column to text/);
  assert.throws(() => toText({ nested: [new Date(NaN)] }), /Cast the timestamp column to text/);
});
