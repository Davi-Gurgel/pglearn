import type { ReactNode } from "react";
import type { PlanNode } from "../contracts/ipc";

// Small drawings of what a node's algorithm does, shown above its explanation.
// They are schematic, not to scale: a few pages, rows or keys stand for many.
// Shapes keep one meaning in every drawing: a square is a table page, a pill a
// row, a circle a key in an index or hash table. Colors come from CSS
// (styles.css, `.diagram`): `hit` is what the node touches, `dim` what it skips.

interface Diagram {
  caption: string;
  picture: ReactNode;
}

export function nodeDiagram(node: PlanNode): Diagram | undefined {
  switch (node["Node Type"]) {
    case "Seq Scan":
      return seqScan;
    case "Index Scan":
      return indexScan;
    case "Index Only Scan":
      return indexOnlyScan;
    case "Bitmap Index Scan":
    case "Bitmap Heap Scan":
    case "BitmapAnd":
    case "BitmapOr":
      return bitmapScan;
    case "Nested Loop":
      return nestedLoop;
    case "Hash Join":
    case "Hash":
      return hashJoin;
    case "Merge Join":
      return mergeJoin;
    case "Sort":
    case "Incremental Sort":
      return sort;
    case "Aggregate":
    case "Group":
    case "Unique":
      return aggregate;
    case "Limit":
      return limit;
    case "Gather":
    case "Gather Merge":
      return gather;
    case "Append":
    case "Merge Append":
      return append;
    default:
      return undefined;
  }
}

const W = 300;
const H = 112;

function Svg({ children, label }: { children: ReactNode; label: string }) {
  return (
    <svg className="diagram" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <defs>
        <marker
          id="diagram-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L8,4 L0,8 z" className="fill-ink" />
        </marker>
      </defs>
      {children}
    </svg>
  );
}

const Page = ({ x, y, hit }: { x: number; y: number; hit?: boolean }) => (
  <rect x={x} y={y} width={22} height={26} rx={3} className={hit ? "hit" : "dim"} />
);

const Row = ({ x, y, w = 26, hit }: { x: number; y: number; w?: number; hit?: boolean }) => (
  <rect x={x} y={y} width={w} height={8} rx={4} className={hit ? "hit" : "dim"} />
);

const Key = ({ x, y, hit }: { x: number; y: number; hit?: boolean }) => (
  <circle cx={x} cy={y} r={6} className={hit ? "hit" : "dim"} />
);

const Arrow = ({ d }: { d: string }) => (
  <path d={d} className="line" markerEnd="url(#diagram-arrow)" />
);

const Text = ({ x, y, children }: { x: number; y: number; children: ReactNode }) => (
  <text x={x} y={y} className="label">
    {children}
  </text>
);

const pages = (y: number, hits: (i: number) => boolean) =>
  Array.from({ length: 9 }, (_, i) => <Page key={i} x={20 + i * 30} y={y} hit={hits(i)} />);

// A B-tree: one root, two branches, four leaves. `leaf` is the one searched.
const tree = (cx: number, leaf: number) => (
  <g>
    <path
      d={`M${cx},14 L${cx - 24},38 M${cx},14 L${cx + 24},38 M${cx - 24},38 L${cx - 36},62 M${cx - 24},38 L${cx - 12},62 M${cx + 24},38 L${cx + 12},62 M${cx + 24},38 L${cx + 36},62`}
      className="line"
    />
    <Key x={cx} y={14} hit />
    <Key x={cx - 24} y={38} hit={leaf < 2} />
    <Key x={cx + 24} y={38} hit={leaf >= 2} />
    {[0, 1, 2, 3].map((i) => (
      <Key key={i} x={cx - 36 + i * 24} y={62} hit={i === leaf} />
    ))}
  </g>
);

const seqScan: Diagram = {
  caption: "Every page of the table, one after the other.",
  picture: (
    <Svg label="A row of table pages, all read from left to right">
      <Text x={20} y={24}>
        table pages
      </Text>
      {pages(36, () => true)}
      <Arrow d="M20,80 L282,80" />
      <Text x={20} y={100}>
        read in storage order, each row checked
      </Text>
    </Svg>
  ),
};

const indexScan: Diagram = {
  caption: "Walk the index down to the matching keys, then jump to each row's page.",
  picture: (
    <Svg label="An index tree whose leaf points at two scattered table pages">
      {tree(60, 1)}
      <Text x={14} y={92}>
        index
      </Text>
      <Arrow d="M54,66 C110,70 150,40 186,40" />
      <Arrow d="M54,66 C130,90 220,92 252,74" />
      <Page x={140} y={22} />
      <Page x={176} y={22} hit />
      <Page x={212} y={22} />
      <Page x={248} y={22} />
      <Page x={140} y={54} />
      <Page x={176} y={54} />
      <Page x={212} y={54} />
      <Page x={248} y={54} hit />
      <Text x={140} y={102}>
        table pages
      </Text>
    </Svg>
  ),
};

const indexOnlyScan: Diagram = {
  caption: "The index holds every column needed, so the table is usually skipped.",
  picture: (
    <Svg label="An index tree; the table pages beside it are mostly untouched">
      {tree(60, 1)}
      <Text x={14} y={92}>
        index
      </Text>
      <Page x={140} y={22} />
      <Page x={176} y={22} />
      <Page x={212} y={22} />
      <Page x={248} y={22} />
      <Page x={140} y={54} />
      <Page x={176} y={54} />
      <Page x={212} y={54} />
      <Page x={248} y={54} />
      <Text x={140} y={102}>
        table, mostly skipped
      </Text>
    </Svg>
  ),
};

const bitmapScan: Diagram = {
  caption:
    "The index marks matching locations in a bitmap; the table pages are then read in order.",
  picture: (
    <Svg label="An index fills a bitmap, which selects table pages read left to right">
      {tree(44, 2)}
      <Arrow d="M84,40 L104,40" />
      {Array.from({ length: 12 }, (_, i) => (
        <rect
          key={i}
          x={110 + (i % 6) * 12}
          y={26 + Math.floor(i / 6) * 14}
          width={9}
          height={10}
          rx={2}
          className={[1, 4, 9].includes(i) ? "hit" : "dim"}
        />
      ))}
      <Text x={110} y={18}>
        bitmap
      </Text>
      <Arrow d="M188,40 L206,40" />
      {[0, 1, 2].map((i) => (
        <Page key={i} x={212 + i * 28} y={27} hit={i !== 1} />
      ))}
      <Arrow d="M212,70 L290,70" />
      <Text x={212} y={92}>
        pages in order
      </Text>
    </Svg>
  ),
};

const nestedLoop: Diagram = {
  caption: "For each row of the outer input, run the inner input again.",
  picture: (
    <Svg label="Each outer row loops over the whole inner input">
      <Text x={20} y={18}>
        outer
      </Text>
      {[0, 1, 2, 3].map((i) => (
        <Row key={i} x={20} y={28 + i * 18} w={50} hit={i === 1} />
      ))}
      <Arrow d="M76,50 C120,50 120,32 166,32" />
      <Text x={172} y={18}>
        inner, per outer row
      </Text>
      {[0, 1, 2, 3].map((i) => (
        <Row key={i} x={172} y={28 + i * 18} w={50} hit />
      ))}
      <path d="M232,30 C262,30 262,84 232,84" className="line" markerEnd="url(#diagram-arrow)" />
      <Text x={248} y={104}>
        × loops
      </Text>
    </Svg>
  ),
};

const hashJoin: Diagram = {
  caption: "Build a hash table from the inner input, then probe it once per outer row.",
  picture: (
    <Svg label="Inner rows fill hash buckets; outer rows look up their bucket">
      <Text x={20} y={18}>
        inner
      </Text>
      {[0, 1, 2].map((i) => (
        <Row key={i} x={20} y={28 + i * 16} w={40} hit />
      ))}
      <Arrow d="M64,48 L104,48" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x={112} y={22 + i * 18} width={56} height={14} rx={3} className="dim" />
          <Key x={124} y={29 + i * 18} hit={i !== 2} />
          {i === 1 && <Key x={140} y={29 + i * 18} hit />}
        </g>
      ))}
      <Text x={112} y={104}>
        hash table (memory)
      </Text>
      <Text x={240} y={18}>
        outer
      </Text>
      {[0, 1, 2].map((i) => (
        <Row key={i} x={240} y={28 + i * 16} w={40} hit={i === 0} />
      ))}
      <Arrow d="M236,32 C210,32 200,47 172,47" />
    </Svg>
  ),
};

const mergeJoin: Diagram = {
  caption: "Both inputs come sorted on the join key; walk them side by side, like a zipper.",
  picture: (
    <Svg label="Two sorted columns of keys, equal keys connected">
      <Text x={60} y={14}>
        outer, sorted
      </Text>
      <Text x={180} y={14}>
        inner, sorted
      </Text>
      {[1, 2, 4, 5].map((key, i) => (
        <g key={key}>
          <Key x={90} y={28 + i * 20} hit={key !== 4} />
          <text x={78} y={32 + i * 20} className="label" textAnchor="end">
            {key}
          </text>
        </g>
      ))}
      {[1, 2, 3, 5].map((key, i) => (
        <g key={key}>
          <Key x={210} y={28 + i * 20} hit={key !== 3} />
          <text x={222} y={32 + i * 20} className="label">
            {key}
          </text>
        </g>
      ))}
      <path d="M96,28 L204,28 M96,48 L204,48 M96,88 L204,88" className="line" />
    </Svg>
  ),
};

const heights = [30, 12, 44, 22, 52, 8, 36];

const sort: Diagram = {
  caption: "Collect every input row, then order them. Nothing comes out until the last row is in.",
  picture: (
    <Svg label="Bars of mixed heights become bars in increasing order">
      {heights.map((h, i) => (
        <rect key={i} x={20 + i * 14} y={80 - h} width={10} height={h} rx={2} className="hit" />
      ))}
      <Arrow d="M130,56 L170,56" />
      {[...heights]
        .sort((a, b) => a - b)
        .map((h, i) => (
          <rect key={i} x={180 + i * 14} y={80 - h} width={10} height={h} rx={2} className="hit" />
        ))}
      <Text x={20} y={100}>
        input
      </Text>
      <Text x={180} y={100}>
        sorted
      </Text>
    </Svg>
  ),
};

const groupOf = [0, 1, 0, 2, 1, 0, 2, 1];

const aggregate: Diagram = {
  caption: "Many input rows collapse into one row per group (or one row in total).",
  picture: (
    <Svg label="Rows with three kinds of keys collapse into three result rows">
      {groupOf.map((g, i) => (
        <circle key={i} cx={24 + i * 16} cy={50} r={6} className={`group-${g}`} />
      ))}
      <Arrow d="M160,50 L200,50" />
      {[0, 1, 2].map((g) => (
        <g key={g}>
          <circle cx={222} cy={26 + g * 24} r={7} className={`group-${g}`} />
          <Row x={236} y={22 + g * 24} w={44} hit />
        </g>
      ))}
      <Text x={20} y={92}>
        input rows, by key
      </Text>
      <Text x={214} y={104}>
        one per group
      </Text>
    </Svg>
  ),
};

const limit: Diagram = {
  caption: "Pass rows up until there are enough, then stop asking for more.",
  picture: (
    <Svg label="A stream of rows cut after the first few">
      {Array.from({ length: 9 }, (_, i) => (
        <Row key={i} x={20 + i * 30} y={44} w={24} hit={i < 3} />
      ))}
      <path d="M108,28 L108,70" className="cut" />
      <Text x={20} y={30}>
        returned
      </Text>
      <Text x={116} y={30}>
        never read
      </Text>
    </Svg>
  ),
};

const gather: Diagram = {
  caption: "Worker processes each run a share of the plan below; Gather collects their rows.",
  picture: (
    <Svg label="Three lanes of rows merging into one">
      {["leader", "worker 1", "worker 2"].map((name, i) => (
        <g key={name}>
          <Text x={20} y={28 + i * 30}>
            {name}
          </Text>
          <Row x={84} y={21 + i * 30} w={30} hit />
          <Row x={120} y={21 + i * 30} w={30} hit />
          <Arrow d={`M156,${25 + i * 30} C190,${25 + i * 30} 196,55 226,55`} />
        </g>
      ))}
      <Row x={232} y={51} w={50} hit />
      <Text x={232} y={80}>
        one stream
      </Text>
    </Svg>
  ),
};

const append: Diagram = {
  caption: "Read each child in turn and pass all their rows up, one after another.",
  picture: (
    <Svg label="Several tables read one after another into one stream">
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <Page x={30 + i * 50} y={22} hit />
          <Page x={30 + i * 50 + 6} y={28} hit />
        </g>
      ))}
      <Text x={30} y={74}>
        partitions or UNION parts
      </Text>
      <Arrow d="M186,40 L216,40" />
      {[0, 1, 2, 3].map((i) => (
        <Row key={i} x={224} y={22 + i * 12} w={58} hit />
      ))}
    </Svg>
  ),
};
