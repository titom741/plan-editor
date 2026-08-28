import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_RAIL_SIZES,
  clampRailSize,
  loadCollapsedSections,
  loadRailSizes,
  saveCollapsedSections,
  saveRailSizes,
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

const set = (...ids: PanelSectionId[]) => new Set<PanelSectionId>(ids);

describe("toggleSection", () => {
  it("folds and unfolds one panel without touching the others", () => {
    const folded = toggleSection(set("tools"), "file");
    expect([...folded].sort()).toEqual(["file", "tools"]);
    expect([...toggleSection(folded, "tools")]).toEqual(["file"]);
  });

  it("lets a rail keep several panels open at once", () => {
    // The rails stack rather than behaving as accordions: opening
    // "project" must leave "tools" and "file" exactly as they were.
    expect([...toggleSection(set("project"), "project")]).toEqual([]);
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
    saveCollapsedSections(set("file", "elements"));
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

describe("clampRailSize", () => {
  it("keeps a rail within its bounds", () => {
    expect(clampRailSize("toolsWidthPx", 10_000)).toBe(420);
    expect(clampRailSize("toolsWidthPx", 0)).toBe(180);
    expect(clampRailSize("propertiesPercent", 55)).toBe(55);
  });

  it("rounds away the sub-pixel noise a drag produces", () => {
    expect(clampRailSize("toolsWidthPx", 301.6)).toBe(302);
    expect(clampRailSize("propertiesPercent", 26.793893129770993)).toBe(26.8);
  });

  it("falls back to the default rather than propagating NaN", () => {
    expect(clampRailSize("propertiesWidthPx", Number.NaN)).toBe(
      DEFAULT_RAIL_SIZES.propertiesWidthPx,
    );
  });
});

describe("loadRailSizes", () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it("starts at the defaults", () => {
    expect(loadRailSizes()).toEqual(DEFAULT_RAIL_SIZES);
  });

  it("round-trips through save", () => {
    saveRailSizes({ toolsWidthPx: 300, propertiesWidthPx: 240, propertiesPercent: 35 });
    expect(loadRailSizes()).toEqual({
      toolsWidthPx: 300,
      propertiesWidthPx: 240,
      propertiesPercent: 35,
    });
  });

  it("clamps a stored size instead of reopening with a rail off the screen", () => {
    localStorage.setItem(
      "kl-implantation/panel-sizes/v1",
      JSON.stringify({ toolsWidthPx: 9999, propertiesWidthPx: -5, propertiesPercent: "wide" }),
    );
    expect(loadRailSizes()).toEqual({
      toolsWidthPx: 420,
      propertiesWidthPx: 220,
      propertiesPercent: DEFAULT_RAIL_SIZES.propertiesPercent,
    });
  });
});
