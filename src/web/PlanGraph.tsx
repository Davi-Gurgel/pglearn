import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PlanNode } from "../contracts/ipc";
import { spilledToDisk } from "./explanations";
import {
  nodeFamily,
  nodeLabel,
  nodeOperation,
  nodeTarget,
  rowsComparison,
  sentToParent,
  type NodeFamily,
  type RowsComparison,
  type Sent,
} from "./plan";

// The plan drawn as a tree of cards, root on top, like psql prints it. Rows
// flow upwards: each edge carries what a child sent its parent, and is drawn
// thicker the more rows it carried.

const cardWidth = 248;
const cardHeight = 78;
const columnGap = 24;
const rowGap = 60;

interface Placed {
  node: PlanNode;
  // Set on the card standing in for children left out (see `shownChildren`):
  // `node` is then the first of them.
  hidden?: PlanNode[];
  // Top-left corner of the card.
  x: number;
  y: number;
  parent?: Placed;
  children: Placed[];
}

// An Append over 55 partitions would be a strip of 55 cards with the root far
// out of sight. Past this many children, the first few are drawn and one card
// stands in for the rest until it is clicked.
const maxChildren = 5;
const keptChildren = 3;

// A simple tidy tree: leaves sit side by side, each parent is centered over its
// first and last child. Every subtree is at least one card wide, so subtrees
// never overlap.
function layout(root: PlanNode, isOpen: (node: PlanNode) => boolean) {
  const all: Placed[] = [];
  let maxDepth = 0;
  const place = (node: PlanNode, left: number, depth: number, parent?: Placed) => {
    const placed: Placed = {
      node,
      x: left,
      y: depth * (cardHeight + rowGap),
      parent,
      children: [],
    };
    all.push(placed);
    maxDepth = Math.max(maxDepth, depth);
    let x = left;
    const children = node.Plans ?? [];
    const cut = children.length > maxChildren && !isOpen(node);
    for (const child of cut ? children.slice(0, keptChildren) : children) {
      const { right, placed: kid } = place(child, x, depth + 1, placed);
      placed.children.push(kid);
      x = right + columnGap;
    }
    if (cut) {
      const hidden = children.slice(keptChildren);
      const y = (depth + 1) * (cardHeight + rowGap);
      const stub: Placed = { node: hidden[0]!, hidden, x, y, parent: placed, children: [] };
      all.push(stub);
      placed.children.push(stub);
      x += cardWidth + columnGap;
    }
    const right = placed.children.length > 0 ? x - columnGap : left + cardWidth;
    if (placed.children.length > 0) {
      const first = placed.children[0]!;
      const last = placed.children.at(-1)!;
      placed.x = (first.x + last.x) / 2;
    }
    return { right, placed };
  };
  const { right, placed: top } = place(root, 0, 0);
  return { top, all, width: right, height: maxDepth * (cardHeight + rowGap) + cardHeight };
}

const minScale = 0.25;
const maxScale = 1.5;
const clampScale = (scale: number) => Math.min(maxScale, Math.max(minScale, scale));

export function PlanGraph({
  root,
  divided,
  selected,
  onSelect,
}: {
  root: PlanNode;
  divided: Set<PlanNode>;
  selected: PlanNode | null;
  onSelect: (node: PlanNode | null) => void;
}) {
  const [opened, setOpened] = useState<ReadonlySet<PlanNode>>(new Set());
  const { top, all, width, height } = useMemo(
    () =>
      layout(
        root,
        // A node picked in the text view must have a card to highlight.
        (node) => opened.has(node) || (selected !== null && node.Plans!.includes(selected)),
      ),
    [root, opened, selected],
  );
  const viewport = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const fit = () => {
    const box = viewport.current;
    if (!box) return;
    // Padding is 32px on each side (styles.css, .graph-canvas).
    const fitted = Math.min(1, (box.clientWidth - 64) / width, (box.clientHeight - 64) / height);
    // A huge plan would shrink to dust: stop at a readable size and let the
    // viewport scroll, with the root (where reading starts) in view.
    const scale = Math.max(fitted, 0.7);
    setScale(scale);
    requestAnimationFrame(() => {
      box.scrollTop = 0;
      box.scrollLeft = (top.x + cardWidth / 2) * scale + 32 - box.clientWidth / 2;
    });
  };
  // Only when a new plan arrives: opening hidden children keeps the zoom.
  const fitNewPlan = useEffectEvent(fit);
  useLayoutEffect(() => fitNewPlan(), [root]);

  // Pinch on a trackpad arrives as a wheel event with ctrlKey set. React's
  // onWheel is passive, so it cannot stop the page from zooming instead.
  useEffect(() => {
    const box = viewport.current;
    if (!box) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setScale((scale) => clampScale(scale * Math.exp(-event.deltaY * 0.01)));
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, []);

  // Arrows move along the tree: up to the parent, down to the first child,
  // sideways to siblings.
  const move = (from: Placed, key: string): Placed | undefined => {
    const siblings = from.parent?.children ?? [from];
    const index = siblings.indexOf(from);
    if (key === "ArrowUp") return from.parent;
    if (key === "ArrowDown") return from.children[0];
    if (key === "ArrowLeft") return siblings[index - 1];
    if (key === "ArrowRight") return siblings[index + 1];
    return undefined;
  };

  return (
    <div className="graph">
      <div className="graph-viewport" ref={viewport}>
        <div
          className="graph-canvas"
          style={{ width: width * scale + 64, height: height * scale + 64 }}
        >
          <div
            className="graph-world"
            style={{ width, height, transform: `scale(${scale})` }}
            onClick={(event) => {
              if (event.target === event.currentTarget) onSelect(null);
            }}
          >
            <svg className="graph-edges" width={width} height={height} aria-hidden>
              {all.flatMap((parent) =>
                parent.children.map((child, i) => (
                  <Edge
                    key={all.indexOf(child)}
                    parent={parent}
                    child={child}
                    slot={i - (parent.children.length - 1) / 2}
                    active={selected === parent.node || selected === child.node}
                  />
                )),
              )}
            </svg>
            {all.map((placed, i) =>
              placed.hidden ? (
                <MoreCard
                  key={i}
                  placed={placed}
                  hidden={placed.hidden}
                  onOpen={() => setOpened(new Set(opened).add(placed.parent!.node))}
                />
              ) : (
                <Card
                  key={i}
                  placed={placed}
                  comparison={rowsComparison(placed.node, divided.has(placed.node))}
                  selected={selected === placed.node}
                  onSelect={() => onSelect(selected === placed.node ? null : placed.node)}
                  onMove={(key) => {
                    const next = move(placed, key);
                    if (!next) return false;
                    onSelect(next.node);
                    document.getElementById(cardId(all.indexOf(next)))?.focus();
                    return true;
                  }}
                  id={cardId(i)}
                />
              ),
            )}
          </div>
        </div>
      </div>
      <div className="graph-zoom" role="group" aria-label="Zoom">
        <button onClick={() => setScale((s) => clampScale(s / 1.25))} aria-label="Zoom out">
          −
        </button>
        <button onClick={() => setScale(1)} title="Actual size">
          {Math.round(scale * 100)}%
        </button>
        <button onClick={() => setScale((s) => clampScale(s * 1.25))} aria-label="Zoom in">
          +
        </button>
        <button onClick={fit}>Fit</button>
      </div>
    </div>
  );
}

const cardId = (i: number) => `plan-node-${i}`;

// Thickness grows with the log of the rows, so 10 rows and 10 million both fit.
const strokeFor = (sent: Sent) =>
  sent.kind === "rows" ? 1.5 + Math.min(10, Math.log10(sent.rows + 1) * 2) : 1.5;

function Edge({
  parent,
  child,
  slot,
  active,
}: {
  parent: Placed;
  child: Placed;
  // Position among the parent's children, centered on 0: spreads the arrow
  // tips along the parent's bottom edge.
  slot: number;
  active: boolean;
}) {
  const sent = child.hidden ? sentByAll(child.hidden) : sentToParent(child.node);
  const x1 = child.x + cardWidth / 2;
  const y1 = child.y;
  const x2 =
    parent.x + cardWidth / 2 + slot * Math.min(36, cardWidth / (parent.children.length + 1));
  const y2 = parent.y + cardHeight + 4;
  const middle = (y1 + y2) / 2;
  const stroke = strokeFor(sent);
  // The arrowhead grows with the line, so a thick edge still shows its tip.
  const head = stroke + 7;
  const base = y2 + head;
  return (
    <g className={`edge edge-${sent.kind}${active ? " active" : ""}`}>
      <path
        className="edge-line"
        d={`M${x1},${y1} C${x1},${middle} ${x2},${middle} ${x2},${base - 1}`}
        strokeWidth={stroke}
      />
      <path
        className="edge-head"
        d={`M${x2},${y2} L${x2 + head * 0.7},${base} L${x2 - head * 0.7},${base} z`}
      />
      {/* Just above the child, on the side the curve does not bend to. */}
      <text
        x={x2 > x1 + 1 ? x1 - stroke / 2 - 6 : x1 + stroke / 2 + 6}
        y={y1 - 8}
        textAnchor={x2 > x1 + 1 ? "end" : "start"}
      >
        {sentText(sent)}
      </text>
    </g>
  );
}

// What the children behind a "more" card sent together.
function sentByAll(nodes: PlanNode[]): Sent {
  const sent = nodes.map(sentToParent);
  const rows = sent.flatMap((each) => (each.kind === "rows" ? [each] : []));
  if (rows.length === 0)
    return sent.some((each) => each.kind === "bitmap") ? { kind: "bitmap" } : { kind: "never" };
  return {
    kind: "rows",
    rows: rows.reduce((sum, each) => sum + each.rows, 0),
    approximate: rows.some((each) => each.approximate),
  };
}

function sentText(sent: Sent): string {
  if (sent.kind === "never") return "nothing";
  if (sent.kind === "bitmap") return "a bitmap";
  return `${sent.approximate ? "≈ " : ""}${count(sent.rows)} ${sent.rows === 1 ? "row" : "rows"}`;
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

// Exact up to a million, where the digits stop being readable at a glance.
export const count = (n: number) =>
  n >= 1_000_000 ? compact.format(n) : Number(n.toFixed(2)).toLocaleString("en-US");

// Why this child feeds its parent: "inner" / "outer" under a join, or the name
// of the InitPlan, SubPlan or CTE it computes.
function edgeTag(placed: Placed): string | undefined {
  const subplan = placed.node["Subplan Name"];
  if (subplan) return subplan;
  const joins = ["Nested Loop", "Hash Join", "Merge Join"];
  const relationship = placed.node["Parent Relationship"];
  if (placed.parent && joins.includes(placed.parent.node["Node Type"]) && relationship) {
    return relationship.toLowerCase();
  }
  return undefined;
}

function Card({
  placed,
  comparison,
  selected,
  onSelect,
  onMove,
  id,
}: {
  placed: Placed;
  comparison: RowsComparison;
  selected: boolean;
  onSelect: () => void;
  onMove: (key: string) => boolean;
  id: string;
}) {
  const { node } = placed;
  const family = nodeFamily(node);
  const target = nodeTarget(node);
  const tag = edgeTag(placed);
  return (
    <button
      id={id}
      className={`card family-${family}${selected ? " selected" : ""}${comparison.executed ? "" : " never"}`}
      style={{ left: placed.x, top: placed.y, width: cardWidth, height: cardHeight }}
      aria-pressed={selected}
      title={nodeLabel(node)}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key.startsWith("Arrow") && onMove(event.key)) event.preventDefault();
      }}
    >
      <span className="card-head">
        <FamilyGlyph family={family} />
        <span className="card-operation">{nodeOperation(node)}</span>
        {spilledToDisk(node) && (
          <span className="chip chip-off" title="Ran out of memory and continued on disk">
            disk
          </span>
        )}
        {tag && <span className="card-tag">{tag}</span>}
      </span>
      <span className="card-target">{target ?? " "}</span>
      <span className="card-rows">
        <RowsLine comparison={comparison} />
      </span>
    </button>
  );
}

// Stands in for the children past the first few. Says what they are, so the
// plan still reads right ("50 more Seq Scans") before it is opened.
function MoreCard({
  placed,
  hidden,
  onOpen,
}: {
  placed: Placed;
  hidden: PlanNode[];
  onOpen: () => void;
}) {
  const kinds = new Map<string, number>();
  for (const node of hidden) {
    const operation = nodeOperation(node);
    kinds.set(operation, (kinds.get(operation) ?? 0) + 1);
  }
  return (
    <button
      className="card more"
      style={{ left: placed.x, top: placed.y, width: cardWidth, height: cardHeight }}
      onClick={onOpen}
    >
      <span className="card-head">
        <span className="card-operation">{hidden.length} more</span>
      </span>
      <span className="card-target">
        {[...kinds].map(([operation, n]) => `${operation} ×${n}`).join(", ")}
      </span>
      <span className="card-rows muted">Show them all</span>
    </button>
  );
}

function RowsLine({ comparison }: { comparison: RowsComparison }) {
  if (!comparison.executed) return <span className="muted">never executed</span>;
  const { estimated, actual, loops, verdict, factor } = comparison;
  return (
    <>
      <span className="card-numbers">
        <span className="muted">est</span> {count(estimated)} <span className="muted">got</span>{" "}
        {count(actual)}
        {loops > 1 && <span className="muted"> × {count(loops)}</span>}
      </span>
      <Verdict verdict={verdict} factor={factor} />
    </>
  );
}

export function Verdict({
  verdict,
  factor,
}: {
  verdict: Extract<RowsComparison, { executed: true }>["verdict"];
  factor: number;
}) {
  if (verdict === "parallel" || verdict === "bitmap") return null;
  if (verdict === "close") return <span className="chip chip-close">close</span>;
  const times = factor < 10 ? factor.toFixed(1) : count(Math.round(factor));
  return (
    <span className={`chip ${factor >= 10 ? "chip-far" : "chip-off"}`}>
      {times}× {verdict === "high" ? "over" : "under"}
    </span>
  );
}

// One small shape per family, repeated in the legend so it can be learned.
export function FamilyGlyph({ family }: { family: NodeFamily }): ReactNode {
  const shapes: Record<NodeFamily, ReactNode> = {
    // A table: a cylinder, like a database drum.
    read: (
      <>
        <ellipse cx="8" cy="4" rx="6" ry="2.5" />
        <path d="M2,4 L2,12 A6,2.5 0 0 0 14,12 L14,4" />
      </>
    ),
    // Two inputs merging into one, flowing up.
    combine: <path d="M3,14 L8,7 L13,14 M8,7 L8,2" />,
    // A funnel: many rows in, fewer or reordered rows out.
    transform: <path d="M2,3 L14,3 L9.5,9 L9.5,14 L6.5,12.5 L6.5,9 z" />,
    // An arrow into a page: rows written.
    write: (
      <>
        <rect x="2.5" y="6" width="11" height="8" rx="1.5" />
        <path d="M8,1 L8,9 M5,6 L8,9 L11,6" />
      </>
    ),
    other: <circle cx="8" cy="8" r="5" />,
  };
  return (
    <svg className={`glyph family-${family}`} viewBox="0 0 16 16" aria-hidden>
      {shapes[family]}
    </svg>
  );
}
