import type { PlanNode } from "../contracts/ipc";

// The text psql prints for a node: Postgres's JSON splits "Hash Left Join" or
// "HashAggregate" into several keys, and this puts them back together, so the
// tree reads like the plans in the docs and in tutorials.
export function nodeLabel(node: PlanNode): string {
  let label = node["Node Type"];
  if (label === "Aggregate") label = aggregates[node.Strategy ?? ""] ?? label;
  // INSERT / UPDATE / DELETE / MERGE: psql prints "Insert on film".
  if (label === "ModifyTable" && typeof node["Operation"] === "string") label = node["Operation"];
  // Parallel plans split an aggregate in two: Partial per worker, Finalize after.
  if (node["Partial Mode"] && node["Partial Mode"] !== "Simple") {
    label = `${node["Partial Mode"]} ${label}`;
  }
  if (node["Join Type"] && node["Join Type"] !== "Inner") {
    label = `${label.replace(/ Join$/, "")} ${node["Join Type"]} Join`;
  }
  if (node["Parallel Aware"]) label = `Parallel ${label}`;
  if (node["Scan Direction"] === "Backward") label += " Backward";
  // A Bitmap Index Scan reads only the index, so the index is what it is "on".
  if (node["Node Type"] === "Bitmap Index Scan") return `${label} on ${node["Index Name"]}`;
  if (node["Index Name"]) label += ` using ${node["Index Name"]}`;

  const target = node["Relation Name"] ?? node["CTE Name"] ?? node["Function Name"];
  const alias = node.Alias;
  if (target) label += ` on ${target}${alias && alias !== target ? ` ${alias}` : ""}`;
  else if (alias) label += ` on ${alias}`;
  return label;
}

const aggregates: Record<string, string> = {
  Hashed: "HashAggregate",
  Sorted: "GroupAggregate",
  Mixed: "MixedAggregate",
};

// Postgres's guess (cost, rows, width) next to what happened when it ran.
export function nodeNumbers(node: PlanNode): string {
  const estimate = `(cost=${node["Startup Cost"].toFixed(2)}..${node["Total Cost"].toFixed(2)} rows=${node["Plan Rows"]} width=${node["Plan Width"]})`;
  if (node["Actual Loops"] === 0) return `${estimate} (never executed)`;
  return `${estimate} (actual time=${node["Actual Startup Time"].toFixed(3)}..${node["Actual Total Time"].toFixed(3)} rows=${node["Actual Rows"].toFixed(2)} loops=${node["Actual Loops"]})`;
}

// Both numbers are per loop: `Plan Rows` is what Postgres expected one run of the
// node to produce, `Actual Rows` the average over its runs. A node on the inner
// side of a Nested Loop runs once per outer row, so only `total` (rows x loops)
// is comparable to what the parent received.
export type RowsComparison =
  | { executed: false }
  | {
      executed: true;
      estimated: number;
      actual: number;
      loops: number;
      total: number;
      // How many times too high or too low the estimate was, always >= 1.
      factor: number;
      // "parallel" and "bitmap": the two numbers do not measure the same thing.
      verdict: "close" | "high" | "low" | "parallel" | "bitmap";
    };

export function rowsComparison(node: PlanNode): RowsComparison {
  const loops = node["Actual Loops"];
  if (loops === 0) return { executed: false };
  const estimated = node["Plan Rows"];
  const actual = node["Actual Rows"];
  // Postgres never plans fewer than 1 row but a node can return 0; clamping
  // both avoids dividing by zero, and "0 vs 1" is not a 100x mistake anyway.
  const e = Math.max(estimated, 1);
  const a = Math.max(actual, 1);
  const factor = Math.max(e / a, a / e);
  return {
    executed: true,
    estimated,
    actual,
    loops,
    total: Math.round(actual * loops),
    factor,
    verdict: incomparable(node) ?? (factor < 2 ? "close" : e > a ? "high" : "low"),
  };
}

// Postgres divides a parallel-aware node's estimate among the leader and its
// workers (by a fraction we cannot recover from the node), and when no worker
// launches the one process still reads everything. BitmapAnd / BitmapOr produce
// a bitmap, not rows, so Actual Rows is always 0.
function incomparable(node: PlanNode): "parallel" | "bitmap" | undefined {
  if (node["Node Type"] === "BitmapAnd" || node["Node Type"] === "BitmapOr") return "bitmap";
  return node["Parallel Aware"] ? "parallel" : undefined;
}

// Lines shown under a node, in psql's order. Every other key is left out
// until a milestone needs it.
const detailKeys = [
  "Sort Key",
  "Group Key",
  "Hash Cond",
  "Merge Cond",
  "Join Filter",
  "Rows Removed by Join Filter",
  "Index Cond",
  "Recheck Cond",
  "Rows Removed by Index Recheck",
  "Filter",
  "Rows Removed by Filter",
  "One-Time Filter",
  "Sort Method",
  "Heap Fetches",
  "Index Searches",
  "Subplans Removed",
  "Workers Planned",
  "Workers Launched",
];

export function nodeDetails(node: PlanNode): string[] {
  const lines: string[] = [];
  for (const key of detailKeys) {
    const value = node[key];
    if (value === undefined) continue;
    // psql hides these counts when nothing was removed; JSON always has them.
    if (value === 0 && (key.startsWith("Rows Removed") || key === "Subplans Removed")) continue;
    lines.push(`${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
  }
  // Only true when a setting like enable_seqscan = off was overridden because
  // Postgres had no other way to run the query.
  if (node["Disabled"] === true) lines.push("Disabled: true");
  const buffers = buffersLine(node);
  if (buffers) lines.push(buffers);
  return lines;
}

// Blocks (8 kB pages) this node touched. "hit" came from Postgres's cache;
// "read" had to come from the operating system (its cache or the disk).
function buffersLine(node: PlanNode): string | undefined {
  const groups = (["Shared", "Local", "Temp"] as const).flatMap((group) => {
    const counts = ["Hit", "Read", "Dirtied", "Written"].flatMap((kind) => {
      const value = node[`${group} ${kind} Blocks`];
      return typeof value === "number" && value > 0 ? [`${kind.toLowerCase()}=${value}`] : [];
    });
    return counts.length > 0 ? [`${group.toLowerCase()} ${counts.join(" ")}`] : [];
  });
  return groups.length > 0 ? `Buffers: ${groups.join(", ")}` : undefined;
}
