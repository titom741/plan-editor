import { beforeEach, describe, expect, it } from "vitest";
import {
  loadCollapsedSections,
  saveCollapsedSections,
  toggleSection,
  type PanelSectionId,
} from "./panelSections";

/** The test runner is plain Node — no DOM, so no `localStorage`. */
function installMemoryStorage(): void {
  const entries = new Map<string, string>();
  globalThis.localStorage = {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    removeItem: (key: string) => entries.delete(key),
    setItem: (key: string, value: string) => entries.set(key, value),
  } as Storage;
}

describe("toggleSection", () => {
  it("folds and unfolds one section without touching the others", () => {
    const folded = toggleSection(new Set<PanelSectionId>(["tools"]), "file");
    expect([...folded].sort()).toEqual(["file", "tools"]);
    expect([...toggleSection(folded, "tools")]).toEqual(["file"]);
  });
});

describe("loadCollapsedSections", () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it("starts with everything unfolded", () => {
    expect(loadCollapsedSections().size).toBe(0);
  });

  it("round-trips through save", () => {
    saveCollapsedSections(new Set<PanelSectionId>(["file", "elements"]));
    expect([...loadCollapsedSections()].sort()).toEqual(["elements", "file"]);
  });

  it("drops ids this build cannot unfold", () => {
    saveCollapsedSections(new Set(["tools", "fromTheFuture"] as PanelSectionId[]));
    expect([...loadCollapsedSections()]).toEqual(["tools"]);
  });

  it("survives a stored value that isn't an array", () => {
    localStorage.setItem("kl-implantation/panels/v1", "42");
    expect(loadCollapsedSections().size).toBe(0);
  });
});
