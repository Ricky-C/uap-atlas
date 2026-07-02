import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted faces (Phase 5): the tokens named these families from day one;
// until now the system fallback rendered. Two weights each, latin subsets.
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "./tokens.css";
import "./app.css";
import { App } from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
