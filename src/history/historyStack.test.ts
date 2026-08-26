import { describe, expect, it } from "vitest";
import { canRedo, canUndo, createHistory, pushHistory, redo, replacePresent, undo } from "./historyStack";

describe("createHistory", () => {
  it("starts with the given value as present and empty past/future", () => {
    const history = createHistory("a");
    expect(history).toEqual({ past: [], present: "a", future: [] });
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });
});

describe("pushHistory", () => {
  it("moves the current present into past and sets a new present", () => {
    const history = pushHistory(createHistory("a"), "b");
    expect(history).toEqual({ past: ["a"], present: "b", future: [] });
  });

  it("clears future — a new action invalidates redo", () => {
    let history = createHistory("a");
    history = pushHistory(history, "b");
    history = undo(history);
    expect(canRedo(history)).toBe(true);
    history = pushHistory(history, "c");
    expect(canRedo(history)).toBe(false);
    expect(history.future).toEqual([]);
  });

  it("caps past at 100 entries, dropping the oldest", () => {
    let history = createHistory(0);
    for (let i = 1; i <= 105; i++) {
      history = pushHistory(history, i);
    }
    expect(history.past).toHaveLength(100);
    expect(history.past[0]).toBe(5); // entries 0..4 dropped, oldest kept is "5"
    expect(history.present).toBe(105);
  });
});

describe("replacePresent", () => {
  it("changes present without touching past or future", () => {
    let history = createHistory("a");
    history = pushHistory(history, "b");
    history = undo(history); // present: a, future: [b]
    history = replacePresent(history, "a-edited");
    expect(history).toEqual({ past: [], present: "a-edited", future: ["b"] });
  });
});

describe("undo / redo", () => {
  it("undoes back through several pushed states", () => {
    let history = createHistory(0);
    history = pushHistory(history, 1);
    history = pushHistory(history, 2);
    history = pushHistory(history, 3);

    history = undo(history);
    expect(history.present).toBe(2);
    history = undo(history);
    expect(history.present).toBe(1);
    history = undo(history);
    expect(history.present).toBe(0);
  });

  it("is a no-op when there is nothing to undo", () => {
    const history = createHistory("only");
    expect(undo(history)).toEqual(history);
  });

  it("is a no-op when there is nothing to redo", () => {
    const history = createHistory("only");
    expect(redo(history)).toEqual(history);
  });

  it("redo restores what undo just removed", () => {
    let history = createHistory("a");
    history = pushHistory(history, "b");
    history = pushHistory(history, "c");

    history = undo(history);
    history = undo(history);
    expect(history.present).toBe("a");

    history = redo(history);
    expect(history.present).toBe("b");
    history = redo(history);
    expect(history.present).toBe("c");
    expect(canRedo(history)).toBe(false);
  });

  it("undo then a new push discards the redo branch (no history rewriting surprises)", () => {
    let history = createHistory("a");
    history = pushHistory(history, "b");
    history = undo(history);
    history = pushHistory(history, "z");
    expect(history).toEqual({ past: ["a"], present: "z", future: [] });
  });
});
