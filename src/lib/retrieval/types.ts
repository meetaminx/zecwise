export type Trust = "official" | "primary" | "reputable" | "community" | "unverified";

/** A passage that was actually retrieved and shown to the model. `ref` is the number the model cites. */
export type EvidenceSource = {
  ref: number;
  kind: "kb" | "web";
  url: string;
  title: string;
  publisher: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  trust: Trust;
  snippet: string;
  documentId: string | null;
  chunkId: string | null;
  score: number;
  flags: string[];
};

export type Candidate = Omit<EvidenceSource, "ref">;
