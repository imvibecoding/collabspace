import { describe, expect, it } from "vitest";
import { countWords, filterPrompt, filterPromptSync } from "./prompt-filter";

describe("filterPromptSync", () => {
  it("rejects empty prompts", () => {
    expect(filterPromptSync("   ")).toMatchObject({ allowed: false, code: "empty" });
  });
  it("enforces the room word limit", () => {
    expect(filterPromptSync("a b c d e f g", { max_prompt_words: 6 })).toMatchObject({ code: "too_long" });
    expect(filterPromptSync("a  b c d e  f ", { max_prompt_words: 6 })).toMatchObject({
      allowed: true,
      normalized: "a b c d e f",
    });
  });
  it("blocks global and room-level terms by whole word", () => {
    expect(filterPromptSync("cute nude cat")).toMatchObject({ code: "blocklist" });
    expect(filterPromptSync("children's playground")).toMatchObject({ allowed: true });
    expect(filterPromptSync("acme logo", { blocklist: ["acme"] })).toMatchObject({ code: "blocklist" });
  });
  it("counts words after normalisation", () => {
    expect(countWords("  neon   city  ")).toBe(2);
  });
});

describe("filterPrompt", () => {
  it("runs the classifier only after sync layers pass", async () => {
    let calls = 0;
    const classifier = { check: async () => ((calls += 1), "flagged") };
    expect(await filterPrompt("", {}, classifier)).toMatchObject({ code: "empty" });
    expect(calls).toBe(0);
    expect(await filterPrompt("sunset over hills", {}, classifier)).toMatchObject({ code: "classifier" });
    expect(calls).toBe(1);
  });
  it("passes when classifier returns null", async () => {
    expect(await filterPrompt("sunset over hills", {}, { check: async () => null })).toMatchObject({
      allowed: true,
    });
  });
});
