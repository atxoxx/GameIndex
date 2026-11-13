import { describe, expect, it } from "vitest";
import { ALL_DRAFT_KEYS, SECTION_DRAFT_KEYS } from "./draftKeys";

describe("edit draft keys", () => {
  it("tracks the Online-Fix / FreeTP toggle in the Runner section", () => {
    expect(SECTION_DRAFT_KEYS.runner).toContain("compatOnlineFix");
    expect(ALL_DRAFT_KEYS).toContain("compatOnlineFix");
  });
});
