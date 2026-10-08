import type { Explain, PlanNode } from "../contracts/ipc";

// The text psql prints for a node: Postgres's JSON splits "Hash Left Join" or
// "HashAggregate" into several keys, and this puts them back together, so the
// tree reads like the plans in the docs and in tutorials.
export function nodeLabel(node: PlanNode): string {
  let label = node["Node Type"];
  if (label === "Aggregate") label = aggregates[node.Strategy ?? ""] ?? label;
  if (label === "SetOp" && node.Strategy === "Hashed") label = "HashSetOp";
  // INSERT / UPDATE / DELETE / MERGE: psql prints "Insert on film".
  if (label === "ModifyTable" && typeof node["Operation"] === "string") label = node["Operation"];
  // Parallel plans split an aggregate in two: Partial per worker, Finalize after.
  if (node["Partial Mode"] && node["Partial Mode"] !== "Simple") {
    label = `${node["Partial Mode"]} ${label}`;
  }
  if (node["Join Type"] && node["Join Type"] !== "Inner") {
    label = `${label.replace(/ Join$/, "")} ${node["Join Type"]} Join`;
  }
  // INTERSECT / EXCEPT: psql prints "HashSetOp Except All".
  if (typeof node["Command"] === "string") label += ` ${node["Command"]}`;
  if (node["Parallel Aware"]) label = `Parallel ${label}`;
  if (node["Scan Direction"] === "Backward") label += " Backward";
  // A Bitmap Index Scan reads only the index, so the index is what it is "on".
  if (node["Node Type"] === "Bitmap Index Scan") return `${label} on ${node["Index Name"]}`;
  if (node["Index Name"]) label += ` using ${node["Index Name"]}`;

  const target = node["Relation Name"] ?? node["CTE Name"] ?? node["Function Name"];
  const alias = node.Alias;
  if (target) label += ` on ${named(target, alias)}`;
  else if (alias) label += ` on ${alias}`;
  return label;
}

// psql prints the alias only when the query gave the table another name.
const named = (table: string, alias: string | undefined) =>
  alias && alias !== table ? `${table} ${alias}` : table;

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

export function rowsComparison(node: PlanNode, dividedAmongProcesses: boolean): RowsComparison {
  const loops = node["Actual Loops"];
  if (loops === 0) return { executed: false };
  const estimated = node["Plan Rows"];
  const actual = node["Actual Rows"];
  // Postgres never plans fewer than 1 row, but a node can return 0. Only that
  // exact 0 is lifted to 1 (to avoid dividing by zero; "0 vs 1" is not a 100x
  // mistake). A fractional average like 0.01 over many loops is a real
  // signal and must stay: an estimate of 1 against it is 100x too high.
  const e = Math.max(estimated, 1);
  const a = actual === 0 ? 1 : actual;
  const factor = Math.max(e / a, a / e);
  return {
    executed: true,
    estimated,
    actual,
    loops,
    total: Math.round(actual * loops),
    factor,
    verdict:
      incomparable(node, dividedAmongProcesses) ?? (factor < 2 ? "close" : e > a ? "high" : "low"),
  };
}

// Postgres divides a parallel-aware node's estimate among the leader and its
// workers (by a fraction we cannot recover from the node), and when no worker
// launches the one process still reads everything. BitmapAnd / BitmapOr produce
// a bitmap, not rows, so Actual Rows is always 0.
function incomparable(
  node: PlanNode,
  dividedAmongProcesses: boolean,
): "parallel" | "bitmap" | undefined {
  if (node["Node Type"] === "BitmapAnd" || node["Node Type"] === "BitmapOr") return "bitmap";
  return dividedAmongProcesses ? "parallel" : undefined;
}

// The nodes whose `Plan Rows` is a per-process share. That is not only the
// nodes flagged "Parallel Aware": a Sort or Nested Loop above a Parallel Seq
// Scan, still below the Gather, inherits the divided estimate (and a Sort has
// Parallel Aware false). A node below a Gather with no parallel-aware node in
// its own subtree, like the inner side of a Nested Loop, is not divided.
export function dividedAmongProcesses(root: PlanNode): Set<PlanNode> {
  const divided = new Set<PlanNode>();
  const visit = (node: PlanNode, belowGather: boolean): boolean => {
    const isGather = node["Node Type"] === "Gather" || node["Node Type"] === "Gather Merge";
    let hasParallelAware = node["Parallel Aware"];
    for (const child of node.Plans ?? []) {
      if (visit(child, belowGather || isGather)) hasParallelAware = true;
    }
    if (node["Parallel Aware"] || (belowGather && hasParallelAware)) divided.add(node);
    return hasParallelAware;
  };
  visit(root, false);
  return divided;
}

// Each node's ancestors, nearest first: what a node means can depend on what
// sits above it (a Gather, an Append).
export function ancestors(root: PlanNode): Map<PlanNode, PlanNode[]> {
  const map = new Map<PlanNode, PlanNode[]>();
  const visit = (node: PlanNode, above: PlanNode[]) => {
    map.set(node, above);
    for (const child of node.Plans ?? []) visit(child, [node, ...above]);
  };
  visit(root, []);
  return map;
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
  // INSERT ... ON CONFLICT.
  "Conflict Resolution",
  "Conflict Arbiter Indexes",
  "Conflict Filter",
  "Rows Removed by Conflict Filter",
  "Tuples Inserted",
  "Conflicting Tuples",
];

export function nodeDetails(node: PlanNode): string[] {
  const lines = targetTables(node);
  const isMerge = node["Operation"] === "Merge";
  for (const key of detailKeys) {
    const value = node[key];
    if (value === undefined) continue;
    // MERGE has its own Tuples line, below.
    if (isMerge && key === "Tuples Inserted") continue;
    // psql hides these counts when nothing was removed; JSON always has them.
    if (value === 0 && (key.startsWith("Rows Removed") || key === "Subplans Removed")) continue;
    lines.push(`${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
  }
  // Only true when a setting like enable_seqscan = off was overridden because
  // Postgres had no other way to run the query.
  if (node["Disabled"] === true) lines.push("Disabled: true");
  if (isMerge) {
    // psql shows only the counts above 0, and no line when all are 0.
    const counts = ["Inserted", "Updated", "Deleted", "Skipped"].flatMap((kind) => {
      const value = node[`Tuples ${kind}`];
      return typeof value === "number" && value > 0 ? [`${kind.toLowerCase()}=${value}`] : [];
    });
    if (counts.length > 0) lines.push(`Tuples: ${counts.join(" ")}`);
  }
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

// A write to a partitioned table lists the partitions it may change, each on
// its own line ("Update on payment_p2022_01 payment_1").
function targetTables(node: PlanNode): string[] {
  const targets = node["Target Tables"];
  if (!Array.isArray(targets)) return [];
  return (targets as { "Relation Name": string; Alias?: string }[]).map(
    (target) => `${String(node["Operation"])} on ${named(target["Relation Name"], target.Alias)}`,
  );
}

// The line psql prints for each trigger that ran: a foreign key check is a
// trigger too, named after its constraint. psql adds the table when the
// statement wrote to more than one, which includes an INSERT that Postgres
// routed into a partition (the JSON shows that only as a trigger on a table
// the plan does not name).
export function triggerLines(explain: Explain): string[] {
  const written = modifyTables(explain.Plan).flatMap((node) => {
    const targets = node["Target Tables"];
    return Array.isArray(targets)
      ? (targets as { "Relation Name": string }[]).map((target) => target["Relation Name"])
      : [node["Relation Name"]];
  });
  const showTable =
    written.length > 1 || explain.Triggers.some((trigger) => !written.includes(trigger.Relation));
  return explain.Triggers.map((trigger) => {
    const constraint = trigger["Constraint Name"];
    const name = constraint
      ? `Trigger for constraint ${constraint}`
      : `Trigger ${trigger["Trigger Name"]}`;
    const table = showTable && trigger.Relation ? ` on ${trigger.Relation}` : "";
    return `${name}${table}: time=${trigger.Time.toFixed(3)} calls=${trigger.Calls}`;
  });
}

// INSERT, UPDATE, DELETE and MERGE nodes, also inside a WITH query.
function modifyTables(node: PlanNode): PlanNode[] {
  const below = (node.Plans ?? []).flatMap(modifyTables);
  return node["Node Type"] === "ModifyTable" ? [node, ...below] : below;
}

// Whether the plan has a node that changes rows. A write inside a WITH query
// runs even when the main query does not read it. Writes from CREATE TABLE AS
// or from inside functions have no node, so this can be false for them.
export function writes(root: PlanNode): boolean {
  return modifyTables(root).length > 0;
}
