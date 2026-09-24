import { beforeEach, describe, expect, it } from "vitest";
import { installMemoryStorage } from "../testing/memoryStorage";
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

const set = (...ids: PanelSectionId[]) => new Set<PanelSectionId>(ids);

describe("toggleSection", () => {
  it("folds one panel without touching the others", () => {
    // Folding is never contagious, in either rail: it says something about
    // the panel it was clicked on and nothing about the rest.
    expect([...toggleSection(set("file"), "elements")].sort()).toEqual(["elements", "file"]);
    expect([...toggleSection(set("project", "tools"), "file")].sort()).toEqual([
      "file",
      "project",
      "tools",
    ]);
  });

  it("closes the menu that was open when another is opened", () => {
    // The left rail is one menu at a time: Fichier, Projet, Outils are
    // places you go to pick something and leave.
    const onlyToolsOpen = set("file", "project", "electrical");
    expect([...toggleSection(onlyToolsOpen, "file")].sort()).toEqual([
      "electrical",
      "project",
      "tools",
    ]);
  });

  it("gives Électricité a menu of its own, which closes Outils when opened", () => {
    const onlyToolsOpen = set("file", "project", "electrical");
    expect([...toggleSection(onlyToolsOpen, "electrical")].sort()).toEqual([
      "file",
      "project",
      "tools",
    ]);
  });

  it("leaves the other rail alone when a menu is opened", () => {
    expect(
      [...toggleSection(set("file", "project", "electrical", "elements"), "project")].sort(),
    ).toEqual(["electrical", "elements", "file", "tools"]);
  });

  it("lets the right rail keep both panels open", () => {
    // Properties and Éléments are read *while* editing — the selected
    // object's fields beside the inventory it sits in — so that rail
    // stacks rather than switching.
    expect([...toggleSection(set("properties"), "properties")]).toEqual([]);
    expect([...toggleSection(set("elements"), "elements")]).toEqual([]);
  });

  it("allows a rail with nothing open, so the last menu can be folded away", () => {
    expect([...toggleSection(set("file", "project"), "tools")].sort()).toEqual([
      "file",
      "project",
      "tools",
    ]);
  });
});

describe("loadCollapsedSections", () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it("starts on the tools, with the other menus folded", () => {
    // The palette is the panel used continuously; Fichier and Projet are
    // visited and left.
    expect([...loadCollapsedSections()].sort()).toEqual(["electrical", "file", "project"]);
  });

  it("round-trips through save", () => {
    saveCollapsedSections(set("file", "tools", "project", "elements"));
    expect([...loadCollapsedSections()].sort()).toEqual(["elements", "file", "project", "tools"]);
  });

  it("drops ids this build cannot unfold", () => {
    saveCollapsedSections(
      new Set(["tools", "file", "electrical", "fromTheFuture"] as PanelSectionId[]),
    );
    expect([...loadCollapsedSections()].sort()).toEqual(["electrical", "file", "tools"]);
  });

  it("folds a stored state that left several menus open at once", () => {
    // Written by a build whose left rail stacked. Reopening in that state
    // would show a layout this one has no way to reach again; whoever was
    // in it was drawing, so they land on the palette.
    saveCollapsedSections(set());
    expect([...loadCollapsedSections()].sort()).toEqual(["electrical", "file", "project"]);
  });

  it("keeps the one that was open when the stored state is already valid", () => {
    saveCollapsedSections(set("tools", "project", "electrical"));
    expect([...loadCollapsedSections()].sort()).toEqual(["electrical", "project", "tools"]);
  });

  it("keeps a state saved before Électricité existed on the palette", () => {
    // Its folds never mention the new menu, which would read as open next
    // to Outils; the palette the user left open is the one kept.
    saveCollapsedSections(set("file", "project"));
    expect([...loadCollapsedSections()].sort()).toEqual(["electrical", "file", "project"]);
  });

  it("survives a stored value that isn't an array", () => {
    localStorage.setItem("kl-implantation/panels/v1", "42");
    expect([...loadCollapsedSections()].sort()).toEqual(["electrical", "file", "project"]);
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
