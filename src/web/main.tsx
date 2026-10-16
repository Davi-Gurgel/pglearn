import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// Leave room for native traffic lights only in the desktop window.
if (window.desktopBridge) document.documentElement.classList.add("desktop");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
