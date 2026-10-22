import { describe, expect, it } from "vitest";
import { FOLLOWUP_DELIMITER, FollowupSplitter } from "@/lib/ai/stream-split";

function run(chunks: string[]) {
  const s = new FollowupSplitter();
  let visible = "";
  for (const c of chunks) visible += s.push(c);
  const { rest, followups } = s.finish();
  return { visible: visible + rest, followups };
}

describe("FollowupSplitter", () => {
  it("never leaks the delimiter even when split across chunks", () => {
    const text = `Answer body.\n${FOLLOWUP_DELIMITER}\n- How do I back up my wallet?\n2. What is a viewing key?`;
    for (let size = 1; size < 12; size++) {
      const chunks = text.match(new RegExp(`[\\s\\S]{1,${size}}`, "g"))!;
      const { visible, followups } = run(chunks);
      expect(visible).toBe("Answer body.\n");
      expect(followups).toEqual(["How do I back up my wallet?", "What is a viewing key?"]);
    }
  });
  it("passes through text with no follow-up block, including '<' characters", () => {
    expect(run(["a < b and <<", "< not a delimiter"])).toEqual({ visible: "a < b and <<< not a delimiter", followups: [] });
  });
});
