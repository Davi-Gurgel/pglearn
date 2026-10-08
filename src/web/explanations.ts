import type { PlanNode } from "../contracts/ipc";

// What a plan node does, for someone who knows SQL but not Postgres's
// internals. Text in `backticks` is shown as code. In a plan, a node's first
// child is its "outer" input (drawn above) and the second its "inner" one.
export interface Explanation {
  text: string;
  docs: string;
}

const docs = (page: string) => `https://www.postgresql.org/docs/current/${page}`;

// The page that explains reading plans: the fallback for any node or note
// without a better one.
export const explainDocs = docs("using-explain.html#USING-EXPLAIN-BASICS");

const joinDocs = docs("planner-optimizer.html");
const workMemDocs = docs("runtime-config-resource.html#GUC-WORK-MEM");
const parallelDocs = docs("how-parallel-query-works.html");
const explainAnalyzeDocs = docs("using-explain.html#USING-EXPLAIN-ANALYZE");

// Shown above a plan that wrote, so nobody thinks the data changed.
export const rolledBack: Explanation = {
  text: "Explain ran this statement for real, in a transaction that it then rolled back (`ROLLBACK`), so the data is unchanged. Two things a rollback does not undo: sequence values it took with `nextval()`, like a new `serial` id, are not given back (sequences skip rolled-back values so concurrent inserts never wait for each other), and the row versions it wrote stay in the table as dead rows until `VACUUM` removes them.",
  docs: docs("tutorial-transactions.html"),
};

// Shown under the trigger lines of a plan.
export const triggersRan: Explanation = {
  text: "Triggers ran too. A `BEFORE` trigger's time is part of the Insert, Update or Delete node; `AFTER` triggers run once the whole plan has finished, so their time is only in Execution Time. Each `Trigger for constraint` is a foreign key check, an `AFTER` trigger called for each changed row: inserting checks that the referenced row exists, and deleting or changing a referenced row searches the tables that refer to it, slowly if their foreign key column has no index.",
  docs: explainAnalyzeDocs,
};

// Keyed by "Node Type". Aggregate and SetOp each hide two or more algorithms,
// told apart by "Strategy", so they are keyed by both.
const explanations: Record<string, Explanation> = {
  "Seq Scan": {
    text: "Reads the whole table, page by page in the order it is stored on disk, and checks every row against the `Filter`. No index is used. That is the cheapest way when the query needs a large share of the rows, or when no index matches the condition.",
    docs: joinDocs,
  },
  "Index Scan": {
    text: "Searches an index for the matching entries (`Index Cond`), then fetches each matching row from the table. An index is a separate structure that points to where each row lives. Fast for a few rows; for many, jumping between the index and the table costs more than a Seq Scan. Only the default kind, B-tree, keeps its entries sorted, so its rows come out in index order and can save a Sort; other kinds (GiST, GIN, ...) return them in no useful order, except a nearest-first `Order By` search. `Backward` means a B-tree was read from its end, giving the reverse of the order it was built with: `ORDER BY ... DESC` for the default ascending index, ascending for an index built `DESC`.",
    docs: docs("indexes-ordering.html"),
  },
  "Index Only Scan": {
    text: "Like an Index Scan, but every column the query needs is stored in the index, so it can usually skip the table. It still has to know whether each row is visible to this transaction (a row may be deleted or not yet committed): for that it checks the visibility map, and only reads the table (`Heap Fetches`) for pages not marked all-visible.",
    docs: docs("indexes-index-only-scans.html"),
  },
  "Bitmap Index Scan": {
    text: "Searches an index, but instead of fetching rows one at a time it marks where the matching rows live in a bitmap (one bit per table location) and hands it to the Bitmap Heap Scan above. Its rows count is the number of matches found in the index.",
    docs: docs("indexes-bitmap-scans.html"),
  },
  "Bitmap Heap Scan": {
    text: "Reads the table pages marked in the bitmap built below it, in the order they are stored, each page once. A middle ground between an Index Scan (few rows) and a Seq Scan (most rows). If the bitmap outgrows `work_mem` it remembers whole pages instead of rows (`lossy`), so each row is checked again (`Recheck Cond`).",
    docs: docs("indexes-bitmap-scans.html"),
  },
  BitmapAnd: {
    text: "Combines the bitmaps of the scans below it, keeping only locations marked in all of them: conditions joined with `AND`, each served by its own index.",
    docs: docs("indexes-bitmap-scans.html"),
  },
  BitmapOr: {
    text: "Combines the bitmaps of the scans below it, keeping locations marked in any of them: conditions joined with `OR`, which a single index scan cannot serve.",
    docs: docs("indexes-bitmap-scans.html"),
  },
  "Tid Scan": {
    text: "Fetches rows by their physical location (`ctid`: page number and position in the page), as in `WHERE ctid = '(0,1)'`. Rare in application code: a row's ctid changes when it is updated.",
    docs: docs("ddl-system-columns.html#DDL-SYSTEM-COLUMNS-CTID"),
  },
  "Tid Range Scan": {
    text: "Reads the rows whose physical location (`ctid`) falls in a range of pages, as in `WHERE ctid < '(10,0)'`.",
    docs: docs("ddl-system-columns.html#DDL-SYSTEM-COLUMNS-CTID"),
  },
  "Sample Scan": {
    text: "Reads a random sample of the table, for `TABLESAMPLE`.",
    docs: docs("sql-select.html#SQL-FROM"),
  },
  "Subquery Scan": {
    text: "Reads the output of a subquery in `FROM` that Postgres could not merge into the outer query (because of a `LIMIT`, for example), usually to apply a `Filter` on top.",
    docs: docs("queries-table-expressions.html#QUERIES-SUBQUERIES"),
  },
  "Function Scan": {
    text: "Calls a function that returns rows, like `generate_series` or `unnest`, used in `FROM`. Most functions produce their whole result before the first row is read.",
    docs: docs("queries-table-expressions.html#QUERIES-TABLEFUNCTIONS"),
  },
  "Table Function Scan": {
    text: "Turns a document into rows, for `XMLTABLE` or `JSON_TABLE` in `FROM`.",
    docs: docs("functions-xml.html#FUNCTIONS-XML-PROCESSING-XMLTABLE"),
  },
  "Values Scan": {
    text: "Returns the rows of a `VALUES` list written in the query.",
    docs: docs("queries-values.html"),
  },
  "CTE Scan": {
    text: "Reads the result of a `WITH` query. Postgres runs the `WITH` query once, as its rows are needed, and keeps them so every reader sees the same copy. A `WITH` query used only once is normally merged into the main query instead; this node appears when it is `MATERIALIZED`, used more than once, or recursive.",
    docs: docs("queries-with.html#QUERIES-WITH-CTE-MATERIALIZATION"),
  },
  "Recursive Union": {
    text: "Runs a `WITH RECURSIVE` query: first its non-recursive part, then the recursive part over and over, each round reading the rows the previous round produced (WorkTable Scan), until a round produces nothing.",
    docs: docs("queries-with.html#QUERIES-WITH-RECURSIVE"),
  },
  "WorkTable Scan": {
    text: "Inside a `WITH RECURSIVE` query, reads the rows the previous round produced. Its loops are the number of rounds.",
    docs: docs("queries-with.html#QUERIES-WITH-RECURSIVE"),
  },
  "Nested Loop": {
    text: "Joins two inputs the simplest way: for each row of the outer input (the first child), runs the inner input (the second) and keeps the pairs that match. The inner side runs once per outer row, hence its loops. Great when the outer side is small and the inner side is an index lookup; slow when both are large. The only join method that works for any condition, not just `=`.",
    docs: joinDocs,
  },
  "Hash Join": {
    text: "Joins two inputs by building a hash table (a lookup table keyed by the join columns) from the inner input, in the Hash node below, then reading the outer input and looking each row up in it. Needs an `=` condition (`Hash Cond`). Good for large inputs in any order, as long as the hash table fits in memory.",
    docs: joinDocs,
  },
  "Merge Join": {
    text: "Joins two inputs that are both sorted on the join columns, walking through them in step like merging two sorted lists. Needs an `=` condition (`Merge Cond`). The sorted order comes from an index or a Sort below. Good for large inputs that are already sorted.",
    docs: joinDocs,
  },
  Hash: {
    text: "Builds the hash table that the Hash Join above looks rows up in. Its rows are the rows put into the table. `Batches` above 1 means it did not fit in memory and was split into parts written to disk.",
    docs: joinDocs,
  },
  Materialize: {
    text: "Keeps the rows of the node below in memory (or on disk, if there are many) so that a parent reading them again, like the inner side of a Nested Loop, does not rerun the node below each time.",
    docs: docs("runtime-config-query.html#GUC-ENABLE-MATERIAL"),
  },
  Memoize: {
    text: "A cache on the inner side of a Nested Loop: remembers the rows returned for each value of the `Cache Key`, so when the same value comes again it answers from the cache instead of running the node below. `Hits` were answered from the cache; `Evictions` mean the cache was too small for all the values.",
    docs: docs("runtime-config-query.html#GUC-ENABLE-MEMOIZE"),
  },
  Sort: {
    text: "Sorts its input by the `Sort Key`. It must read all of its input before returning the first row, which is why its startup time is close to its total. Used for `ORDER BY`, and to feed nodes that need sorted input (Merge Join, GroupAggregate, Unique, window functions). `quicksort` sorted in memory, `top-N heapsort` kept only the first rows a Limit asked for, `external merge` ran out of memory and used disk.",
    docs: docs("queries-order.html"),
  },
  "Incremental Sort": {
    text: "Sorts an input that is already sorted by the first sort columns (`Presorted Key`): it only sorts each group of rows that share those columns, so it needs less memory and can return rows before reading everything.",
    docs: docs("runtime-config-query.html#GUC-ENABLE-INCREMENTAL-SORT"),
  },
  "Aggregate:Plain": {
    text: "Computes aggregates (`count`, `sum`, `max`, ...) over all of its input as a single group, and returns one row. This is an aggregate without `GROUP BY`.",
    docs: docs("tutorial-agg.html"),
  },
  "Aggregate:Sorted": {
    text: "GroupAggregate: computes aggregates per group from input sorted by the `Group Key`, so each group's rows arrive together and the group is finished when the key changes. Uses little memory and keeps the sorted order, but needs sorted input.",
    docs: docs("queries-table-expressions.html#QUERIES-GROUP"),
  },
  "Aggregate:Hashed": {
    text: "HashAggregate: computes aggregates per group by keeping a running total for each `Group Key` in a hash table, and returns the groups after reading all of its input. The input can be in any order, but every group must fit in memory (or spill to disk), and the output has no particular order. Also used for `DISTINCT`.",
    docs: docs("queries-table-expressions.html#QUERIES-GROUP"),
  },
  "Aggregate:Mixed": {
    text: "MixedAggregate: computes several groupings in one pass, for `GROUPING SETS`, `ROLLUP` or `CUBE`, hashing some of them and using the sorted order of the input for others.",
    docs: docs("queries-table-expressions.html#QUERIES-GROUPING-SETS"),
  },
  Group: {
    text: "Returns one row per group of its sorted input, for a `GROUP BY` without aggregates.",
    docs: docs("queries-table-expressions.html#QUERIES-GROUP"),
  },
  WindowAgg: {
    text: "Computes window functions (`OVER (...)`, like `rank()` or a running `sum`): for each row, a value over a set of related rows, without merging the rows the way `GROUP BY` does. Its input is sorted by the window's `PARTITION BY` and `ORDER BY`.",
    docs: docs("tutorial-window.html"),
  },
  Unique: {
    text: "Removes duplicates from sorted input by comparing each row with the one before it, for `DISTINCT` or `UNION`.",
    docs: docs("queries-select-lists.html#QUERIES-DISTINCT"),
  },
  "SetOp:Sorted": {
    text: "Runs `INTERSECT` (rows in both inputs) or `EXCEPT` (rows of the first input not in the second) by walking both inputs, sorted, side by side. With `ALL`, duplicates count.",
    docs: docs("queries-union.html"),
  },
  "SetOp:Hashed": {
    text: "HashSetOp: runs `INTERSECT` (rows in both inputs) or `EXCEPT` (rows of the first input not in the second) by counting each distinct row in a hash table. The inputs can be in any order. With `ALL`, duplicates count.",
    docs: docs("queries-union.html"),
  },
  Limit: {
    text: "Returns only the first rows (`LIMIT`), after skipping some (`OFFSET`), and then stops asking the node below for more. That is why the nodes under a Limit often return far fewer rows than estimated: they were never run to the end.",
    docs: docs("queries-limit.html"),
  },
  LockRows: {
    text: "Locks each row it passes up, for `FOR UPDATE` or `FOR SHARE`, so other transactions cannot change it until this one ends.",
    docs: docs("sql-select.html#SQL-FOR-UPDATE-SHARE"),
  },
  Append: {
    text: "Runs its children one after another and returns all their rows: `UNION ALL`, or a partitioned table, with one child per partition. `Subplans Removed` counts partitions skipped because the condition rules them out (partition pruning).",
    docs: docs("ddl-partitioning.html#DDL-PARTITION-PRUNING"),
  },
  "Merge Append": {
    text: "Like Append, but each child is sorted and it merges them keeping the order: for example an `ORDER BY` over a partitioned table, read through an index on each partition.",
    docs: docs("ddl-partitioning.html#DDL-PARTITION-PRUNING"),
  },
  Result: {
    text: "Produces rows without reading a table: a `SELECT` with no `FROM`, the computed columns of the node below, or a `One-Time Filter`, a condition checked once before anything below runs (when it is false, nothing below runs at all).",
    docs: explainDocs,
  },
  ProjectSet: {
    text: "Runs functions that return several rows (like `generate_series`) written in the `SELECT` list, turning each input row into several.",
    docs: docs("functions-srf.html"),
  },
  Gather: {
    text: "Starts worker processes that each run a copy of the plan below, on their own share of the data, and collects their rows in no particular order. The main process (the leader) usually works too. `Workers Launched` can be lower than `Workers Planned` when the server has no workers left.",
    docs: parallelDocs,
  },
  "Gather Merge": {
    text: "Like Gather, but each worker's rows are sorted and it merges them keeping the order.",
    docs: parallelDocs,
  },
  ModifyTable: {
    text: "Changes the table in its label (`Insert on`, `Update on`, `Delete on`, `Merge on`) with the rows the node below produces: the new rows for an INSERT, otherwise the rows to change or delete. Postgres never changes a row in place: an UPDATE writes a new version of the row and marks the old one dead, a DELETE only marks it, so transactions that started earlier can still read the old version (MVCC). Without `RETURNING` it passes no rows up, so its rows are 0: the rows below are the ones it was given to change. A MERGE counts what its `WHEN` clauses did on the `Tuples` line.",
    docs: explainAnalyzeDocs,
  },
};

// The explanation for the node's algorithm, or undefined if not written yet.
export function nodeExplanation(node: PlanNode): Explanation | undefined {
  const type = node["Node Type"];
  const key = type === "Aggregate" || type === "SetOp" ? `${type}:${node.Strategy}` : type;
  return explanations[key];
}

// The plan's sides are the children, not the tables in your SQL: Postgres may
// swap a LEFT JOIN's sides (to hash the smaller table) and print Right Join.
const joinTypes: Record<string, string> = {
  Left: "Left join: every row of the outer input (the first child) is returned, even without a match; the inner input's columns are then NULL.",
  Right:
    "Right join: every row of the inner input (the second child) is returned, even without a match. Postgres may swap the sides of your `LEFT JOIN` when that is cheaper, so Left and Right here refer to the children, not to your SQL.",
  Full: "Full join: rows of both inputs are returned even without a match, with NULLs for the missing side.",
  Semi: "Semi join: returns each row of the outer input at most once, as soon as it finds one match in the inner input, whose columns are never returned. This is how `EXISTS` and `IN (subquery)` run.",
  Anti: "Anti join: returns the rows of the outer input that have no match in the inner input. This is how `NOT EXISTS` runs, and often `LEFT JOIN ... WHERE ... IS NULL`.",
  "Right Semi":
    "Right semi join: a semi join (`EXISTS`, `IN`) with the sides swapped, returning rows of the inner input that have a match in the outer one, so the hash table can be built from the smaller side.",
  "Right Anti":
    "Right anti join: an anti join (`NOT EXISTS`) with the sides swapped, returning rows of the inner input that have no match in the outer one, so the hash table can be built from the smaller side.",
};

// Remarks about this particular node, beyond what its type does: how it joins,
// whether it ran in parallel, whether it ran out of memory. `ancestors` are
// the node's parents, nearest first.
export function nodeNotes(node: PlanNode, ancestors: PlanNode[]): Explanation[] {
  const notes: Explanation[] = [];
  const joinType = joinTypes[node["Join Type"] ?? ""];
  if (joinType) {
    notes.push({ text: joinType, docs: docs("queries-table-expressions.html#QUERIES-JOIN") });
  }
  if (node["Parallel Aware"]) {
    notes.push({
      text: "Parallel: several processes run this node at once, each on its own share of the data, and a Gather above collects their rows.",
      docs: docs("parallel-plans.html#PARALLEL-SCANS"),
    });
  }
  if (node["Partial Mode"] === "Partial") {
    const finalize = ancestors.findIndex(isFinalize);
    const path = finalize === -1 ? ancestors : ancestors.slice(0, finalize);
    notes.push(
      twoSteps(
        "Partial: the first of two aggregation steps. It aggregates only part of the rows and passes an intermediate result (like a count so far) up to a Finalize aggregate, which combines them.",
        path,
        " It runs in parallel processes, below a Gather, each aggregating the rows it read.",
        " Each partition gets its own (partitionwise aggregate), and an Append collects their results.",
      ),
    );
  }
  if (isFinalize(node)) {
    notes.push(
      twoSteps(
        "Finalize: the second of two aggregation steps. It combines the intermediate results of the Partial aggregates below into the final ones.",
        towardsPartials(node),
        " Those ran in parallel processes, whose rows a Gather collected.",
        " There is one per partition (partitionwise aggregate).",
      ),
    );
  }
  const conflict = node["Conflict Resolution"];
  if (typeof conflict === "string") {
    notes.push({
      text: `\`ON CONFLICT DO ${conflict}\`: a row whose key is already in a unique index (\`Conflict Arbiter Indexes\`, or any unique index for \`DO NOTHING\` without a target) is ${conflict === "NOTHING" ? "skipped" : "used to update the existing row instead"}. \`Conflicting Tuples\` counts those rows, \`Tuples Inserted\` the others.`,
      docs: docs("sql-insert.html#SQL-ON-CONFLICT"),
    });
  }
  const spill = spilled(node);
  if (spill) notes.push({ text: spill, docs: workMemDocs });
  const heapFetches = node["Heap Fetches"];
  if (typeof heapFetches === "number" && heapFetches > 0) {
    notes.push({
      text: `${heapFetches.toLocaleString("en-US")} ${heapFetches === 1 ? "row" : "rows"} still had to be read from the table (\`Heap Fetches\`), because ${heapFetches === 1 ? "its page was" : "their pages were"} not marked all-visible. \`VACUUM\` marks pages all-visible; until it runs, recently changed tables make an Index Only Scan behave like an Index Scan.`,
      docs: docs("routine-vacuuming.html#VACUUM-FOR-VISIBILITY-MAP"),
    });
  }
  return notes;
}

// An aggregate split in two (Partial below, Finalize above) is either parallel
// (a Gather between the steps) or partitionwise (an Append between them, one
// Partial per partition), or both at once. Without either, say neither.
function twoSteps(
  text: string,
  between: PlanNode[],
  parallel: string,
  perPartition: string,
): Explanation {
  const isParallel = between.some(isGather);
  const isPerPartition = between.some(
    (node) => node["Node Type"] === "Append" || node["Node Type"] === "Merge Append",
  );
  return {
    text: text + (isParallel ? parallel : "") + (isPerPartition ? perPartition : ""),
    docs:
      isPerPartition && !isParallel
        ? docs("runtime-config-query.html#GUC-ENABLE-PARTITIONWISE-AGGREGATE")
        : docs("parallel-plans.html#PARALLEL-AGGREGATION"),
  };
}

const isFinalize = (node: PlanNode) => node["Partial Mode"] === "Finalize";
const isGather = (node: PlanNode) =>
  node["Node Type"] === "Gather" || node["Node Type"] === "Gather Merge";

// The nodes below a Finalize aggregate, down to (not including) its Partials.
function towardsPartials(finalize: PlanNode): PlanNode[] {
  const nodes: PlanNode[] = [];
  const visit = (node: PlanNode) => {
    if (node["Partial Mode"] === "Partial") return;
    nodes.push(node);
    node.Plans?.forEach(visit);
  };
  finalize.Plans?.forEach(visit);
  return nodes;
}

const memoryAdvice =
  "Disk is slower. Raising `work_mem` for the session (`SET work_mem = '64MB'`) can reduce or avoid the spill, if the server can spare the memory: the limit applies to each sort or hash table separately, and a query can run several at once, in each of its processes.";

// Sort, Hash and HashAggregate run out of memory past `work_mem` (hash tables:
// times `hash_mem_multiplier`) and continue on disk. In a parallel plan each
// process reports its own numbers, under "Workers"; the node's own keys are
// the leader's, absent when the leader did not take part.
function spilled(node: PlanNode): string | undefined {
  const reports = [node, ...(Array.isArray(node["Workers"]) ? node["Workers"] : [])] as Record<
    string,
    unknown
  >[];
  const most = (key: string, only?: (report: Record<string, unknown>) => boolean) =>
    Math.max(
      0,
      ...reports.flatMap((report) => {
        const value = report[key];
        return typeof value === "number" && (!only || only(report)) ? [value] : [];
      }),
    );
  const kB = (n: number) => `${n.toLocaleString("en-US")} kB`;

  const type = node["Node Type"];
  if (type === "Sort") {
    const disk = most("Sort Space Used", (report) => report["Sort Space Type"] === "Disk");
    if (disk > 0)
      return `Sorted on disk (${kB(disk)}): the rows did not fit in \`work_mem\`, the memory one sort may use (4 MB by default). ${memoryAdvice}`;
  }
  if (type === "Hash") {
    // Already the largest across processes. Postgres doubles the batches when
    // the table grows past its memory, so more than planned means the inner
    // input was bigger than estimated.
    const batches = most("Hash Batches");
    const planned = most("Original Hash Batches");
    if (batches > 1) {
      const surprise =
        planned < batches ? ` It planned ${planned}: the input was larger than estimated.` : "";
      return `The hash table did not fit in memory, so it was split into ${batches} batches, all but one written to disk and joined one at a time.${surprise} A hash table may use \`work_mem\` × \`hash_mem_multiplier\` (4 MB × 2 = 8 MB by default). ${memoryAdvice}`;
    }
  }
  if (type === "Aggregate" && node.Strategy !== "Plain") {
    const disk = most("Disk Usage");
    if (disk > 0)
      return `The groups did not fit in memory, so ${kB(disk)} of them went to disk and were aggregated in later passes. A hash table may use \`work_mem\` × \`hash_mem_multiplier\` (4 MB × 2 = 8 MB by default). ${memoryAdvice}`;
  }
  return undefined;
}
