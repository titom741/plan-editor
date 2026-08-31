import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./ui/App.tsx";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found in index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    // Relative, so the worker is found — and scoped — wherever the build
    // is deployed: "./sw.js" resolves against the page, not the domain root.
    void navigator.serviceWorker.register("./sw.js").catch(() => {
      // L'application reste pleinement utilisable en ligne si le navigateur
      // refuse les service workers (contexte non sécurisé, politique locale).
    });
  });
}
