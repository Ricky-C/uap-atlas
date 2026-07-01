import { Globe } from "./Globe";
import { Drawer } from "./Drawer";
import { Timeline } from "./Timeline";

export function App() {
  return (
    <main style={{ background: "var(--bg-surface)" }}>
      <Globe records={[]} />
      <Drawer />
      <Timeline />
    </main>
  );
}
