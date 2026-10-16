// Small line icons in the style of SF Symbols, drawn on a 16-unit grid with the
// current text color, so they follow the theme and the button's state.

import type { ReactNode } from "react";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden>
      {children}
    </svg>
  );
}

export const SidebarIcon = () => (
  <Icon>
    <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
    <path d="M6 2.5v11" />
  </Icon>
);

export const PlayIcon = () => (
  <Icon>
    <path d="M5 3.2v9.6L12.5 8z" className="filled" />
  </Icon>
);

export const StopIcon = () => (
  <Icon>
    <rect x="4" y="4" width="8" height="8" rx="1.5" className="filled" />
  </Icon>
);

// A tiny plan: one node feeding two.
export const PlanIcon = () => (
  <Icon>
    <path d="M8 5.5L4.5 10.5M8 5.5l3.5 5" />
    <circle cx="8" cy="4" r="2" />
    <circle cx="4" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
  </Icon>
);

export const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg className={open ? "icon chevron open" : "icon chevron"} viewBox="0 0 16 16" aria-hidden>
    <path d="M6 4l4 4-4 4" />
  </svg>
);

export const DatabaseIcon = () => (
  <Icon>
    <ellipse cx="8" cy="4" rx="5" ry="2" />
    <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
  </Icon>
);

export const SchemaIcon = () => (
  <Icon>
    <path d="M1.5 4.5a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
  </Icon>
);

export const TableIcon = () => (
  <Icon>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="M1.5 6h13M1.5 9.5h13M6 6v7.5" />
  </Icon>
);

// A table split into stacked pieces: its rows live in the partitions.
export const PartitionedIcon = () => (
  <Icon>
    <rect x="1.5" y="2.5" width="13" height="3.5" rx="1" />
    <rect x="1.5" y="7" width="13" height="3" rx="1" />
    <rect x="1.5" y="11" width="13" height="2.5" rx="1" />
  </Icon>
);

// An eye: a view is a saved query you look through.
export const ViewIcon = () => (
  <Icon>
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2" />
  </Icon>
);

export const ScriptIcon = () => (
  <Icon>
    <path d="M3.5 1.5h6l3 3v10h-9z" />
    <path d="M6 8h4.5M6 10.5h4.5" />
  </Icon>
);

// The pager's arrows: to the first page, the previous, the next, the last.
const pagePaths = {
  first: "M11 4L7 8l4 4M4.5 4v8",
  previous: "M10 4L6 8l4 4",
  next: "M6 4l4 4-4 4",
  last: "M5 4l4 4-4 4M11.5 4v8",
};

export const PageIcon = ({ to }: { to: keyof typeof pagePaths }) => (
  <Icon>
    <path d={pagePaths[to]} />
  </Icon>
);
