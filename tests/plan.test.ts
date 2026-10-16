import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlanNode } from "../src/contracts/ipc.ts";
import { dividedAmongProcesses, rowsComparison, sentToParent } from "../src/web/plan.ts";

const node = (values: Partial<PlanNode> = {}): PlanNode => ({
  "Node Type": "Seq Scan",
  "Parallel Aware": false,
  "Startup Cost": 0,
  "Total Cost": 1,
  "Plan Rows": 1,
  "Plan Width": 4,
  "Actual Startup Time": 0,
  "Actual Total Time": 1,
  "Actual Rows": 1,
  "Actual Loops": 1,
  ...values,
});

test("fractional rows stay per loop while edge totals include every loop", () => {
  const scan = node({ "Actual Rows": 0.01, "Actual Loops": 1000 });
  assert.deepEqual(rowsComparison(scan, false), {
    executed: true,
    estimated: 1,
    actual: 0.01,
    loops: 1000,
    total: 10,
    factor: 100,
    verdict: "high",
  });
  assert.deepEqual(sentToParent(scan), { kind: "rows", rows: 10, approximate: true });
});

test("never executed, zero rows and bitmaps describe different work", () => {
  assert.deepEqual(sentToParent(node({ "Actual Loops": 0 })), { kind: "never" });
  assert.deepEqual(sentToParent(node({ "Actual Rows": 0 })), {
    kind: "rows",
    rows: 0,
    approximate: false,
  });
  assert.deepEqual(sentToParent(node({ "Node Type": "Bitmap Index Scan" })), { kind: "bitmap" });
  const bitmap = rowsComparison(node({ "Node Type": "BitmapAnd", "Actual Rows": 0 }), false);
  assert.ok(bitmap.executed && bitmap.verdict === "bitmap");
});

test("parallel estimates propagate to a sort but not a nested loop's independent inner scan", () => {
  const scan = node({ "Parallel Aware": true });
  const inner = node();
  const join = node({ "Node Type": "Nested Loop", Plans: [scan, inner] });
  const sort = node({ "Node Type": "Sort", Plans: [join] });
  const gather = node({ "Node Type": "Gather", Plans: [sort] });
  assert.deepEqual(dividedAmongProcesses(gather), new Set([scan, join, sort]));
  const comparison = rowsComparison(sort, true);
  assert.ok(comparison.executed && comparison.verdict === "parallel");
});
