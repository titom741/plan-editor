import { describe, expect, it } from "vitest";
import { createDemoProject } from "../domain/project";
import { buildDiagnosticReport } from "./report";

describe("diagnostic report", () => {
  it("summarises the project without leaking drawing content", () => {
    const project = createDemoProject();
    const environment = {
      userAgent: "test",
      language: "fr",
      viewportWidth: 1200,
      viewportHeight: 800,
      devicePixelRatio: 2,
      indexedDbAvailable: true,
    };
    const report = buildDiagnosticReport(project, environment, "2026-08-27T12:00:00.000Z");
    expect(report.project.objectCount).toBe(project.objects.length);
    expect(report.project.objectsByType.rectangle).toBeGreaterThan(0);
    const text = JSON.stringify(report);
    expect(text).not.toContain("Chapiteau principal");
    expect(text).not.toContain("pointsM");
    expect(text).not.toContain("data:image");
  });
});
