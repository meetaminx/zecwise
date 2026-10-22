export const CATEGORIES = [
  "zcash_fundamentals",
  "protocol_cryptography",
  "shielded_transparent_transactions",
  "wallets_workflows",
  "security_privacy",
  "ecosystem_applications",
  "developer_documentation",
  "network_protocol_updates",
  "blockchain_comparisons",
  "current_events_community",
  "general_conversation",
  "other_general_knowledge",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  zcash_fundamentals: "Zcash fundamentals",
  protocol_cryptography: "Protocol and cryptography",
  shielded_transparent_transactions: "Shielded and transparent transactions",
  wallets_workflows: "Wallets and transaction workflows",
  security_privacy: "Security and privacy",
  ecosystem_applications: "Ecosystem applications",
  developer_documentation: "Developer documentation",
  network_protocol_updates: "Network and protocol updates",
  blockchain_comparisons: "Blockchain comparisons",
  current_events_community: "Current events and community",
  general_conversation: "General conversation",
  other_general_knowledge: "Other general knowledge",
};
