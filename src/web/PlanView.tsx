import { Fragment, useMemo, useState } from "react";
import type { Explain, PlanNode } from "../contracts/ipc";
import { nodeDiagram } from "./diagrams";
import {
  explainDocs,
  nodeExplanation,
  nodeNotes,
  rolledBack,
  triggersRan,
  type Explanation,
} from "./explanations";
import {
  ancestors,
  dividedAmongProcesses,
  nodeDetails,
  nodeFamily,
  nodeLabel,
  nodeNumbers,
  nodeOperation,
  nodeTarget,
  rowsComparison,
  triggerLines,
  writes,
  type NodeFamily,
} from "./plan";
import { count, FamilyGlyph, PlanGraph, Verdict } from "./PlanGraph";

// One plan, as a graph or as psql's text, with the selected node explained
// beside it. Both views share the selection.
export function PlanView({ explain }: { explain: Explain }) {
  const [selected, setSelected] = useState<PlanNode | null>(null);
  const [view, setView] = useState<"graph" | "text">("graph");
  const divided = useMemo(() => dividedAmongProcesses(explain.Plan), [explain]);
  const above = useMemo(() => ancestors(explain.Plan), [explain]);
  const wrote = writes(explain.Plan);

  return (
    <div className="plan">
      <div className="plan-bar">
        <div className="tabs" role="tablist">
          {(["graph", "text"] as const).map((name) => (
            <button
              key={name}
              role="tab"
              aria-selected={view === name}
              onClick={() => setView(name)}
            >
              {name === "graph" ? "Graph" : "Text, like psql"}
            </button>
          ))}
        </div>
        <span className="timing">
          <span className="muted">Planning</span> {ms(explain["Planning Time"])}
        </span>
        <span className="timing">
          <span className="muted">Execution</span> {ms(explain["Execution Time"])}
        </span>
        <details className="rolled-back">
          <summary>{wrote ? "Changes rolled back" : "Rolled back"}</summary>
          <div className="popover">
            <Paragraph explanation={rolledBack(wrote)} />
          </div>
        </details>
      </div>
      <div className="plan-body">
        <div className="plan-main">
          {view === "graph" ? (
            <PlanGraph
              root={explain.Plan}
              divided={divided}
              selected={selected}
              onSelect={setSelected}
            />
          ) : (
            <pre className="plan-text">
              <PlanTree node={explain.Plan} selected={selected} onSelect={setSelected} />
              {`Planning Time: ${explain["Planning Time"].toFixed(3)} ms\n`}
              {triggerLines(explain).map((line) => `${line}\n`)}
              {`Execution Time: ${explain["Execution Time"].toFixed(3)} ms`}
            </pre>
          )}
        </div>
        <aside className="inspector">
          {selected ? (
            <NodeStats
              node={selected}
              divided={divided.has(selected)}
              ancestors={above.get(selected) ?? []}
              onClose={() => setSelected(null)}
            />
          ) : (
            <Legend explain={explain} />
          )}
        </aside>
      </div>
    </div>
  );
}

const ms = (value: number) => `${value < 10 ? value.toFixed(2) : Math.round(value)} ms`;

const familyNames: Record<NodeFamily, string> = {
  read: "Reads rows from a table, an index or a function",
  combine: "Combines two or more inputs: joins, appends",
  transform: "Sorts, groups, limits or buffers the rows it gets",
  write: "Inserts, updates or deletes rows",
  other: "Plumbing: gathers parallel workers, computes values",
};

// Shown while nothing is selected: how to read the drawing.
function Legend({ explain }: { explain: Explain }) {
  const triggers = triggerLines(explain);
  return (
    <div className="legend">
      <h3>Reading the plan</h3>
      <p>
        Each box is a step Postgres ran. Rows start at the bottom, where tables are read, and flow
        up through the arrows to the top box, which returns the result. The thicker an arrow, the
        more rows it carried. Click a box to see what it does.
      </p>
      <ul className="families">
        {(Object.keys(familyNames) as NodeFamily[]).map((family) => (
          <li key={family}>
            <FamilyGlyph family={family} />
            {familyNames[family]}
          </li>
        ))}
      </ul>
      <p>
        <span className="muted">est</span> is how many rows Postgres expected,{" "}
        <span className="muted">got</span> how many came out, per loop. The tag says how far apart
        they were:
      </p>
      <ul className="chips">
        <li>
          <span className="chip chip-close">close</span> within 2×
        </li>
        <li>
          <span className="chip chip-off">4.0× over</span> expected too many
        </li>
        <li>
          <span className="chip chip-far">120× under</span> expected far too few
        </li>
      </ul>
      <p>
        Plans are chosen from those estimates, so a step far off is often where a slow query goes
        wrong.{" "}
        <a href={explainDocs} target="_blank" rel="noreferrer">
          Using EXPLAIN
        </a>
      </p>
      {triggers.length > 0 && (
        <>
          <h3>Triggers</h3>
          <pre className="trigger-lines">{triggers.join("\n")}</pre>
          <Paragraph explanation={triggersRan} />
        </>
      )}
    </div>
  );
}

// Indented like psql's text output: each child one level deeper, under "->".
// `arrow` is the column of this node's "->" (the root has none); its detail
// lines and children line up two columns past the arrow's tip.
function PlanTree({
  node,
  arrow,
  selected,
  onSelect,
}: {
  node: PlanNode;
  arrow?: number;
  selected: PlanNode | null;
  onSelect: (node: PlanNode | null) => void;
}) {
  const head = arrow === undefined ? "" : `${" ".repeat(arrow)}->  `;
  const inner = " ".repeat(head.length + 2);
  const toggle = () => onSelect(selected === node ? null : node);
  return (
    <>
      <span
        role="button"
        tabIndex={0}
        aria-pressed={selected === node}
        className="plan-text-node"
        onClick={() => {
          // Dragging to copy some of the plan also ends in a click: keep the selection.
          if (window.getSelection()?.toString()) return;
          toggle();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
          }
        }}
      >
        {`${head}${nodeLabel(node)}  ${nodeNumbers(node)}\n`}
        {nodeDetails(node).map((line) => `${inner}${line}\n`)}
      </span>
      {node.Plans?.map((child, i) =>
        // InitPlans, SubPlans and CTEs get a name line, and sit under it.
        child["Subplan Name"] ? (
          <Fragment key={i}>
            {`${inner}${child["Subplan Name"]}\n`}
            <PlanTree
              node={child}
              arrow={inner.length + 2}
              selected={selected}
              onSelect={onSelect}
            />
          </Fragment>
        ) : (
          <PlanTree
            key={i}
            node={child}
            arrow={inner.length}
            selected={selected}
            onSelect={onSelect}
          />
        ),
      )}
    </>
  );
}

const plural = (n: number, word: string) => `${count(n)} ${word}${n === 1 ? "" : "s"}`;

function NodeStats({
  node,
  divided,
  ancestors,
  onClose,
}: {
  node: PlanNode;
  divided: boolean;
  ancestors: PlanNode[];
  onClose: () => void;
}) {
  const rows = rowsComparison(node, divided);
  const table = node["Relation Name"];
  const family = nodeFamily(node);
  const target = nodeTarget(node);
  const diagram = nodeDiagram(node);
  const details = nodeDetails(node);
  return (
    <div className={`node-stats family-${family}`}>
      <div className="node-title">
        <FamilyGlyph family={family} />
        <div>
          <h3>{nodeOperation(node)}</h3>
          {target && <code className="node-target">{target}</code>}
        </div>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      {diagram && (
        <figure>
          {diagram.picture}
          <figcaption>{diagram.caption}</figcaption>
        </figure>
      )}

      <NodeExplanation node={node} ancestors={ancestors} />

      <h4>Estimated vs actual rows</h4>
      {!rows.executed ? (
        <p>
          Never executed: Postgres planned this step but the query finished without needing it (for
          example a Limit stopped early, or the other side of a join was empty). There is nothing to
          compare.
        </p>
      ) : (
        <>
          <RowsBars estimated={rows.estimated} actual={rows.actual} />
          <p className="loops">
            {rows.loops > 1 ? (
              <>
                Per loop. This step ran <strong>{plural(rows.loops, "time")}</strong> (for example
                once per row of a Nested Loop&apos;s outer side), so it sent about{" "}
                {plural(rows.total, "row")} up in total.
              </>
            ) : (
              "This step ran once."
            )}{" "}
            <Verdict verdict={rows.verdict} factor={rows.factor} />
          </p>
          {rows.verdict === "close" && <p>The estimate was close (within 2×).</p>}
          {rows.verdict === "parallel" && (
            <p>
              Not comparable: Postgres splits a parallel step&apos;s estimate among the leader and
              its workers. Compare the Gather above instead.
            </p>
          )}
          {rows.verdict === "bitmap" && (
            <p>
              Not comparable: this step builds a bitmap of table locations, not rows, so Postgres
              always reports 0 actual rows. Look at the Bitmap Index Scans below it.
            </p>
          )}
          {(rows.verdict === "high" || rows.verdict === "low") && (
            <>
              <p>
                Postgres expected{" "}
                <strong>
                  {rows.factor < 10 ? rows.factor.toFixed(1) : count(Math.round(rows.factor))}×{" "}
                  {rows.verdict === "high" ? "more" : "fewer"}
                </strong>{" "}
                rows than it got.
              </p>
              {rows.verdict === "high" && (
                <p>
                  Not always a mistake: a step stops reading early when its parent needs no more
                  rows (Limit, EXISTS, Merge Join, an empty join side), but the estimate assumes it
                  reads everything.
                </p>
              )}
              {rows.factor >= 10 && (
                <p>
                  {rows.verdict === "high"
                    ? "If it did read everything, statistics may be stale or missing"
                    : "A gap this large often means stale or missing statistics"}
                  {table ? (
                    <>
                      : try running <code>ANALYZE {table}</code> and explain again
                    </>
                  ) : (
                    ", or columns that are correlated"
                  )}
                  .
                </p>
              )}
            </>
          )}
        </>
      )}
      <p className="muted">
        Estimates come from statistics that <code>ANALYZE</code> collects (autovacuum also runs it
        in the background).{" "}
        <a href={statsDocs} target="_blank" rel="noreferrer">
          Planner statistics
        </a>
      </p>

      {details.length > 0 && (
        <>
          <h4>Details</h4>
          <dl className="details">
            {details.map((line, i) => {
              // "Filter: (rating = 'G')" → term and value. Lines without a
              // colon (a partition of a write) are shown whole.
              const at = line.indexOf(": ");
              return at === -1 ? (
                <dd key={i}>{line}</dd>
              ) : (
                <Fragment key={i}>
                  <dt>{line.slice(0, at)}</dt>
                  <dd>{line.slice(at + 2)}</dd>
                </Fragment>
              );
            })}
          </dl>
        </>
      )}
    </div>
  );
}

const statsDocs = "https://www.postgresql.org/docs/current/planner-stats.html";

// Two bars on a log scale: 10 vs 10,000 rows must both stay visible, and equal
// steps of length mean equal factors.
function RowsBars({ estimated, actual }: { estimated: number; actual: number }) {
  const top = Math.log10(Math.max(estimated, actual, 1) + 1);
  const width = (n: number) => `${Math.max(2, (Math.log10(n + 1) / top) * 100)}%`;
  return (
    <div className="bars">
      <span>Estimated</span>
      <div className="bar-track">
        <div className="bar bar-estimated" style={{ width: width(estimated) }} />
      </div>
      <span className="tabular">{count(estimated)}</span>
      <span>Actual</span>
      <div className="bar-track">
        <div className="bar bar-actual" style={{ width: width(actual) }} />
      </div>
      <span className="tabular">{count(actual)}</span>
    </div>
  );
}

function NodeExplanation({ node, ancestors }: { node: PlanNode; ancestors: PlanNode[] }) {
  const explanation = nodeExplanation(node);
  const notes = nodeNotes(node, ancestors);
  return (
    <>
      {explanation ? (
        <Paragraph explanation={explanation} />
      ) : (
        <p>
          No explanation written for {node["Node Type"]} yet.{" "}
          <a href={explainDocs} target="_blank" rel="noreferrer">
            Using EXPLAIN
          </a>
        </p>
      )}
      {notes.map((note) => (
        <Paragraph key={note.text} explanation={note} className="note" />
      ))}
    </>
  );
}

// `backticks` in the text become <code>: the odd pieces of the split.
function Paragraph({ explanation, className }: { explanation: Explanation; className?: string }) {
  return (
    <p className={className}>
      {explanation.text
        .split("`")
        .map((piece, i) => (i % 2 ? <code key={i}>{piece}</code> : piece))}{" "}
      <a href={explanation.docs} target="_blank" rel="noreferrer">
        Docs
      </a>
    </p>
  );
}
