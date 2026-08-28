import type { Project } from "../domain/types";
import { buildDiagnosticReport } from "../diagnostics/report";

export function downloadDiagnosticReport(project: Project) {
  const report = buildDiagnosticReport(project, {
    userAgent: navigator.userAgent,
    language: navigator.language,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    indexedDbAvailable: typeof indexedDB !== "undefined",
  });
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `kl-diagnostic-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
