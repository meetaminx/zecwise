/**
 * Heuristic flags for instruction-like text inside ingested documents. These do
 * not make content safe; the real defence is that retrieved text is always passed
 * to the model as quoted, untrusted evidence and the answer model has no tools.
 * Flags are stored on the document so admins can review them, and flagged
 * passages are marked when shown to the model.
 */
const PATTERNS: Array<[string, RegExp]> = [
  ["ignore_instructions", /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|above|all|system)\b[^.\n]{0,20}\b(instructions?|prompts?|rules?)\b/i],
  ["role_override", /\b(you are now|act as|pretend to be|new instructions?:|system prompt:)/i],
  ["secret_request", /\b(enter|share|send|paste|provide|type)\b[^.\n]{0,40}\b(seed phrase|recovery phrase|mnemonic|private key|spending key)\b/i],
  ["exfiltration", /\b(send|post|forward)\b[^.\n]{0,40}\b(conversation|chat history|user data)\b[^.\n]{0,40}\b(to|at)\b/i],
  ["fake_markup", /<\/?(system|assistant|instructions?|source|evidence)\b[^>]*>/i],
];

export function detectInjection(text: string): string[] {
  const flags: string[] = [];
  for (const [name, pattern] of PATTERNS) if (pattern.test(text)) flags.push(name);
  return flags;
}

/** Neutralises tag-like sequences so document text cannot close or forge the evidence wrapper. */
export function neutralizeMarkup(text: string): string {
  return text.replace(/<\/?\s*(system|assistant|user|instructions?|source|evidence|sources)\b[^>]*>/gi, (m) => m.replace(/</g, "‹").replace(/>/g, "›"));
}
