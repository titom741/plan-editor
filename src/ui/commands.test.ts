import { describe, expect, it, beforeEach } from "vitest";
import { installMemoryStorage } from "../testing/memoryStorage";
import {
  COMMANDS,
  DEFAULT_PINNED_COMMANDS,
  getCommand,
  loadPinnedCommands,
  savePinnedCommands,
  togglePinnedCommand,
  type CommandId,
} from "./commands";

describe("command registry", () => {
  it("has no duplicate ids", () => {
    const ids = COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every command a label, a short label and a tooltip", () => {
    for (const command of COMMANDS) {
      expect(command.label.length).toBeGreaterThan(0);
      expect(command.shortLabel.length).toBeGreaterThan(0);
      expect(command.title.length).toBeGreaterThan(0);
    }
  });

  it("only pins commands that exist by default", () => {
    for (const id of DEFAULT_PINNED_COMMANDS) expect(getCommand(id)).toBeDefined();
  });
});

describe("togglePinnedCommand", () => {
  it("adds a missing id and removes a present one", () => {
    expect(togglePinnedCommand([], "export")).toEqual(["export"]);
    expect(togglePinnedCommand(["export"], "export")).toEqual([]);
  });

  it("keeps the registry's order rather than insertion order, so the toolbar never reshuffles", () => {
    // "library" comes after "export" in COMMANDS, so it must land after it
    // even though it was pinned first.
    const pinned = togglePinnedCommand(togglePinnedCommand([], "library"), "export");
    expect(pinned).toEqual(["export", "library"]);
  });
});

describe("loadPinnedCommands", () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it("falls back to the defaults when nothing is stored", () => {
    expect(loadPinnedCommands()).toEqual([...DEFAULT_PINNED_COMMANDS]);
  });

  it("round-trips through save", () => {
    savePinnedCommands(["export", "schedule"]);
    expect(loadPinnedCommands()).toEqual(["export", "schedule"]);
  });

  it("drops ids this build does not know", () => {
    savePinnedCommands(["export", "fromTheFuture" as CommandId]);
    expect(loadPinnedCommands()).toEqual(["export"]);
  });

  it("survives a stored value that isn't an array", () => {
    localStorage.setItem("kl-implantation/toolbar/v1", '"nope"');
    expect(loadPinnedCommands()).toEqual([...DEFAULT_PINNED_COMMANDS]);
  });
});
