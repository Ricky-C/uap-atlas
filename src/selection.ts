// Shared list↔globe hover state (TICKETS.md T4). The source matters: the list
// only auto-scrolls for globe-originated hover, and the globe never needs to
// react to its own echoes.

export interface HoverState {
  id: string;
  source: "list" | "globe";
}
