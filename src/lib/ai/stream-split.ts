export const FOLLOWUP_DELIMITER = "<<<FOLLOWUPS>>>";

/**
 * Splits a streamed answer into the visible body and a trailing follow-up block
 * the model writes after FOLLOWUP_DELIMITER. Text that might be the start of the
 * delimiter is held back until it can be classified, so the delimiter never
 * flashes in the UI.
 */
export class FollowupSplitter {
  private pending = "";
  private inTail = false;
  private tail = "";

  push(chunk: string): string {
    if (this.inTail) {
      this.tail += chunk;
      return "";
    }
    this.pending += chunk;
    const idx = this.pending.indexOf(FOLLOWUP_DELIMITER);
    if (idx >= 0) {
      const visible = this.pending.slice(0, idx);
      this.tail = this.pending.slice(idx + FOLLOWUP_DELIMITER.length);
      this.pending = "";
      this.inTail = true;
      return visible;
    }
    // Hold back the longest suffix that is a prefix of the delimiter.
    let hold = 0;
    for (let n = Math.min(FOLLOWUP_DELIMITER.length - 1, this.pending.length); n > 0; n--) {
      if (FOLLOWUP_DELIMITER.startsWith(this.pending.slice(-n))) {
        hold = n;
        break;
      }
    }
    const visible = this.pending.slice(0, this.pending.length - hold);
    this.pending = this.pending.slice(this.pending.length - hold);
    return visible;
  }

  /** Flushes held text and returns the parsed follow-up questions (at most 3). */
  finish(): { rest: string; followups: string[] } {
    const rest = this.inTail ? "" : this.pending;
    this.pending = "";
    const followups = this.tail
      .split("\n")
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
      .filter((line) => line.length > 3 && line.length < 200 && !line.includes(FOLLOWUP_DELIMITER))
      .slice(0, 3);
    return { rest, followups };
  }
}
