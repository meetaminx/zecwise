/**
 * Detects and redacts things that look like wallet secrets in user messages
 * before they are sent to the model or stored. This is defence in depth: the
 * assistant is also instructed never to ask for or repeat secrets.
 */
const PATTERNS: Array<[string, RegExp]> = [
  // Zcash Sapling extended spending keys (mainnet and testnet).
  ["zcash_spending_key", /\bsecret-extended-key-(?:main|test)1[02-9ac-hj-np-z]{100,}\b/gi],
  // Sprout spending keys.
  ["zcash_sprout_key", /\bS[KT][1-9A-HJ-NP-Za-km-z]{50,}\b/g],
  // Bitcoin-style WIF private keys (also used for Zcash transparent keys).
  ["wif_private_key", /\b[5KL][1-9A-HJ-NP-Za-km-z]{50,51}\b/g],
  // Extended private keys.
  ["extended_private_key", /\b[xyzt]prv[1-9A-HJ-NP-Za-km-z]{100,}\b/g],
];

// 32-byte hex strings are usually transaction ids, so only treat them as keys when the user says so.
const HEX_KEY = /\b(?:0x)?[a-f0-9]{64}\b/gi;
const HEX_KEY_CONTEXT = /\b(private|secret|spending)[ -]?key\b/i;

// 12–24 consecutive lowercase words of 3–8 letters, the shape of a BIP-39 mnemonic.
const MNEMONIC = /\b(?:[a-z]{3,8}[\s,]+){11,23}[a-z]{3,8}\b/g;
const MNEMONIC_CONTEXT = /\b(seed|mnemonic|recovery|phrase|words|backup|restore|wallet)\b/i;

export function redactSecrets(text: string): { text: string; found: string[] } {
  const found = new Set<string>();
  let out = text;
  for (const [name, pattern] of PATTERNS) {
    out = out.replace(pattern, () => {
      found.add(name);
      return "[REDACTED SECRET]";
    });
  }
  if (HEX_KEY_CONTEXT.test(text)) {
    out = out.replace(HEX_KEY, () => {
      found.add("hex_private_key");
      return "[REDACTED SECRET]";
    });
  }
  if (MNEMONIC_CONTEXT.test(text)) {
    out = out.replace(MNEMONIC, (match) => {
      const words = match.split(/[\s,]+/);
      // Ordinary prose has short function words; mnemonics rarely repeat words and lack them.
      const functionWords = words.filter((w) => /^(the|and|for|that|with|this|from|have|you|are|was|but|not|what|how|can|its|our)$/.test(w)).length;
      if (functionWords > 1 || new Set(words).size < words.length - 1) return match;
      found.add("seed_phrase");
      return "[REDACTED SEED PHRASE]";
    });
  }
  return { text: out, found: [...found] };
}
