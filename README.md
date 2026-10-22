# ZecWise

**Your guide to everything Zcash.** ZecWise is an AI research assistant for Zcash: a chat interface backed by a curated, citation-checked knowledge base, live web search, an admin dashboard for managing sources, and an automated evaluation suite.

Built with Next.js 16 (App Router), TypeScript, Tailwind CSS 4, Postgres/Supabase with pgvector, and Claude through the Anthropic SDK on the server.

## What works today, and what needs configuration

| Feature | Status | Needs |
| --- | --- | --- |
| Chat UI (streaming, starters, sources, related reading, follow-ups, copy, feedback, simpler / more technical, mobile layout) | Working | — |
| Answers from Claude (topic routing, grounded answers, follow-up context) | Working once configured | `ANTHROPIC_API_KEY` |
| Conversation history and feedback | Working once configured | `DATABASE_URL` |
| Knowledge base ingestion (pages, website sections, RSS/Atom, GitHub releases), dedupe, change detection, robots.txt, retries, job queue | Working, covered by integration tests | `DATABASE_URL` |
| Keyword retrieval (Postgres full-text) | Working, covered by integration tests | `DATABASE_URL` |
| Semantic retrieval (hybrid with pgvector) | Implemented; not exercised in this build environment | `VOYAGE_API_KEY` |
| Live web search | Implemented (Tavily, Brave); not exercised in this build environment | `TAVILY_API_KEY` or `BRAVE_SEARCH_API_KEY` |
| Citation validation (unknown refs removed, invented URLs flagged, weak support flagged) | Working, unit-tested | — |
| Admin dashboard with roles (admin / editor / viewer) | Working | `DATABASE_URL`, `SESSION_SECRET` |
| Scheduled ingestion | Working (`/api/cron/ingest` or `npm run worker`) | `CRON_SECRET` for the HTTP route |
| Evaluation suite (33 cases, deterministic graders + model judge, run history) | Implemented; graders unit-tested; full run needs a key | `ANTHROPIC_API_KEY` |

Nothing in the app fakes an answer. Without an API key the chat shows a setup notice instead of responding, the sidebar says history is off without a database, and each answer states whether the knowledge base and live search actually ran.

## Quick start

```bash
npm install
cp .env.example .env.local        # fill in the keys you have
npm run db:migrate                # needs DATABASE_URL in the environment
npm run create-admin -- you@example.com 'a long passphrase' admin
npm run seed:sources              # optional: registers a starter set of public Zcash sources
npm run worker -- --once          # ingest queued sources now
npm run dev
```

Scripts read `.env` via dotenv; with `.env.local`, export the variables or run `set -a; source .env.local; set +a` first.

**Supabase:** create a project, enable the `vector` extension (Database → Extensions), copy the connection string into `DATABASE_URL`, then run `npm run db:migrate`. ZecWise uses its own email/password sign-in for admins (bcrypt + signed httpOnly session cookie), so Supabase Auth is not required.

**Deploying on Vercel:** set the env vars, and `vercel.json` schedules `/api/cron/ingest` every 30 minutes (Vercel sends `CRON_SECRET` automatically). For large backfills run `npm run worker` on any long-running host; several workers can run at once.

## How a question is answered

1. **Secrets are redacted.** Seed phrases, spending keys and similar strings are removed before the model sees or the database stores the message, and the model is told to warn the user.
2. **Plan.** A small structured-output call classifies the question into the 12 ZecWise categories and decides whether it needs the knowledge base and/or live search, writing a standalone search query that resolves follow-up references. A keyword heuristic takes over if that call fails.
3. **Retrieve.** Hybrid search over indexed passages (Postgres full-text + pgvector, fused with reciprocal rank fusion) and, when needed, live search. Passages are ranked by relevance × source trust × freshness (freshness only matters for time-sensitive questions), with at most two passages per URL.
4. **Generate.** Claude receives the passages as numbered, untrusted `<evidence>` along with a `<retrieval_status>` block saying exactly what ran. The model has no tools, so nothing inside a document can trigger an action. Server-side refusal fallback is enabled (`fallbacks: "default"`).
5. **Validate.** Citation markers are checked against the retrieved set: unknown refs are removed, URLs in the text that were not retrieved are flagged in the UI, and citations whose passage shares little vocabulary with the cited sentence are recorded as weak.
6. **Store.** Answers, retrieved source metadata (separately, in `message_sources`), retrieval events and token usage are persisted.

## Project layout

```
src/app                    pages and API routes (chat, conversations, feedback, auth, admin, cron)
src/components/chat        chat interface
src/components/admin       admin dashboard
src/lib/ai                 prompts, planner, orchestrator, secret redaction, stream parsing
src/lib/retrieval          knowledge base search, embeddings, ranking
src/lib/search             live web search providers and host trust
src/lib/citations          citation validation
src/lib/ingestion          fetcher (robots.txt, rate limits), extraction, chunking, feeds, pipeline, job queue
src/lib/auth               sessions, passwords, role guard, anonymous visitor ids
db/migrations              SQL schema
scripts                    migrate, create-admin, seed-sources, worker
evals                      dataset, graders, runner, results
tests                      unit and integration tests
```

## Tests

```bash
npm test                   # unit + integration (integration needs DATABASE_URL, see .env.test)
npm run test -- --project unit
```

Integration tests run the real ingestion pipeline against a local HTTP server and a real Postgres with pgvector: crawling within a path prefix, robots.txt, loop prevention, duplicate and change detection, failure recording, RSS ingestion, retrieval, disabled-source exclusion, and citation validation against retrieved records. CI runs lint, type-check, tests and a production build with a pgvector service container.

## Evaluation

```bash
npm run eval                         # all cases, with model judge (uses API credits)
npm run eval -- --category secrets   # one category
npm run eval -- --no-judge           # deterministic checks only
npm run eval -- --review <file> <caseId> pass|fail "notes"   # record a manual verification
```

The dataset (`evals/dataset.json`) covers beginner questions, shielded transactions, wallets, sending/receiving, privacy and security, comparisons, current developments, developer docs, general questions, follow-ups, conflicting and insufficient evidence, prompt injection in retrieved pages, seed-phrase and key handling, and fabricated citations. Each run records model, prompt version (a hash of the system prompt), git commit and dataset version, writes a JSON + Markdown report to `evals/results/`, stores results in `eval_runs` / `eval_results`, and lists regressions against the previous run. Reports state that results are automated and keep manual verification separate.

**The eval suite has not been run yet** because no API key was available while building. Treat the system as unverified until a full run has been reviewed.

## Security notes

- Provider keys are read only in `src/lib/config.ts`, which imports `server-only`; `/api/status` exposes booleans, never values.
- Admin routes enforce roles on the server and re-read the user's role from the database on every request. `src/proxy.ts` only does an optimistic redirect.
- Ingestion refuses private and loopback addresses, caps response size, respects robots.txt and `noindex`, and spaces requests per host.
- Retrieved text is wrapped as untrusted evidence, tag-like sequences are neutralised, and instruction-like content is flagged in the dashboard and down-ranked.
- The chat rate limiter is in-memory (per instance). Put a shared limiter in front for multi-instance deployments.

## Known limitations

- Live search, embeddings and the answer model were not exercised end to end in the build environment (no keys, restricted network). Unit and integration tests cover everything that does not need a paid provider.
- PDFs (for example the Zcash protocol specification PDF) are not ingested yet; HTML, plain text, feeds and GitHub releases are.
- Claim-level support checking at runtime is a lexical heuristic; the eval judge does the stricter check.
