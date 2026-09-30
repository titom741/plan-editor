import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../domain/project";
import { exportFileName } from "./exportSheet";

describe("exportFileName", () => {
  it("drops the project extension instead of stacking the export's on it", () => {
    const project = createEmptyProject({ name: "Plan d'implantation 2026" });
    expect(exportFileName(project, "pdf")).toBe("plan-d-implantation-2026.pdf");
    expect(exportFileName(project, "png")).toBe("plan-d-implantation-2026.png");
  });
});
