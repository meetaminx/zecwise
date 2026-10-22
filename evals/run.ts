/**
 * ZecWise evaluation runner.
 *
 *   npm run eval                          # run every case with the model judge
 *   npm run eval -- --case shielded-eli5  # run selected cases (comma separated)
 *   npm run eval -- --category secrets    # run one category
 *   npm run eval -- --no-judge            # deterministic checks only
 *   npm run eval -- --review <runFile> <caseId> pass|fail "notes"   # record a manual verification
 *
 * Every run calls the real pipeline (planner, knowledge base, live search when
 * configured, answer model) and costs API credits. Results are written to
 * evals/results/ and, when DATABASE_URL is set, to the eval_runs/eval_results tables,
 * tagged with the model and prompt version so failures can be tracked across changes.
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { runConversation, type ChatEvent } from "../src/lib/ai/orchestrator";
import { PROMPT_VERSION } from "../src/lib/ai/prompts";
import type { HistoryTurn } from "../src/lib/ai/router";
import { featureStatus, config } from "../src/lib/config";
import { getPool } from "../src/lib/db";
import type { Candidate } from "../src/lib/retrieval/types";
import { Dataset, JUDGE_RUBRIC, JudgeOutput, deterministicChecks, passFromScores, type CheckResult, type EvalCase, type Observation } from "./graders";

const RESULTS_DIR = path.join(process.cwd(), "evals", "results");
const JUDGE_MODEL = process.env.ZECWISE_JUDGE_MODEL ?? "claude-opus-5-5";

type CaseResult = {
  id: string;
  category: string;
  passed: boolean;
  failures: string[];
  checks: CheckResult[];
  judge: JudgeOutput | null;
  answer: string;
  sources: Observation["sources"];
  usedKb: boolean;
  usedLive: boolean;
  manual?: { verdict: "pass" | "fail"; notes: string; at: string } | null;
};

type RunFile = {
  runAt: string;
  model: string;
  judgeModel: string | null;
  promptVersion: string;
  gitSha: string | null;
  datasetVersion: string;
  features: ReturnType<typeof featureStatus>;
  results: CaseResult[];
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function gitSha(): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

async function collect(message: string, history: HistoryTurn[], inject: Candidate[]) {
  let sources: Extract<ChatEvent, { type: "sources" }>["sources"] = [];
  let plan: Extract<ChatEvent, { type: "plan" }> | null = null;
  let done: Extract<ChatEvent, { type: "done" }> | null = null;
  let error: string | null = null;
  for await (const event of runConversation({ message, history }, { injectSources: inject })) {
    if (event.type === "sources") sources = event.sources;
    else if (event.type === "plan") plan = event;
    else if (event.type === "done") done = event;
    else if (event.type === "error") error = event.message;
  }
  return { sources, plan, done, error };
}

function toCandidates(c: EvalCase): Candidate[] {
  // Fixture passages for conflict and injection tests, clearly marked by the .invalid TLD.
  return c.inject_sources.map((s) => ({
    kind: "web",
    url: s.url,
    title: s.title,
    publisher: new URL(s.url).hostname,
    publishedAt: s.published ? new Date(s.published).toISOString() : null,
    retrievedAt: new Date().toISOString(),
    trust: s.trust,
    snippet: s.snippet,
    documentId: null,
    chunkId: null,
    score: 5, // rank fixtures into the evidence set so the model actually sees them
    flags: [],
  }));
}

async function judge(anthropic: Anthropic, c: EvalCase, history: HistoryTurn[], question: string, o: Observation): Promise<JudgeOutput | null> {
  if (!c.criteria.length) return null;
  const sources = o.sources.map((s) => `[${s.ref}] ${s.title} <${s.url}> (${s.kind}, ${s.trust}, published ${s.publishedAt?.slice(0, 10) ?? "unknown"})\n${s.snippet.slice(0, 1500)}`).join("\n\n");
  const response = await anthropic.messages.parse({
    model: JUDGE_MODEL,
    max_tokens: 4000,
    system: JUDGE_RUBRIC,
    output_config: { effort: "medium", format: zodOutputFormat(JudgeOutput) },
    messages: [
      {
        role: "user",
        content: [
          `<criteria>${c.criteria.join(", ")}</criteria>`,
          `<expected_facts>\n${c.expected_facts.map((f) => `- ${f}`).join("\n") || "(none)"}\n</expected_facts>`,
          `<retrieval>knowledge base used: ${o.usedKb}; live web search used: ${o.usedLive}</retrieval>`,
          history.length ? `<earlier_turns>\n${history.map((t) => `${t.role}: ${t.content.slice(0, 2000)}`).join("\n\n")}\n</earlier_turns>` : "",
          `<question>\n${question}\n</question>`,
          `<retrieved_sources>\n${sources || "(none)"}\n</retrieved_sources>`,
          `<answer>\n${o.answer}\n</answer>`,
          "Score only the listed criteria.",
        ].join("\n\n"),
      },
    ],
  });
  return response.parsed_output ?? null;
}

async function runCase(anthropic: Anthropic, c: EvalCase, useJudge: boolean): Promise<CaseResult> {
  const history: HistoryTurn[] = [];
  // Earlier turns run through the real pipeline so follow-ups are tested on real context.
  for (const turn of c.turns.slice(0, -1)) {
    const r = await collect(turn, history, []);
    history.push({ role: "user", content: turn }, { role: "assistant", content: r.done?.text ?? "" });
  }
  const question = c.turns[c.turns.length - 1];
  const r = await collect(question, history, toCandidates(c));
  const features = featureStatus();
  const o: Observation = {
    answer: r.done?.text ?? "",
    rawInvalidCitations: r.done?.citations.invalid ?? [],
    weakCitations: r.done?.citations.weak.length ?? 0,
    unverifiedUrls: r.done?.citations.unverifiedUrls ?? [],
    citedRefs: r.done?.citations.cited ?? [],
    sources: r.sources.map((s) => ({ ref: s.ref, url: s.url, title: s.title, kind: s.kind, snippet: s.snippet, publishedAt: s.publishedAt, trust: s.trust })),
    usedKb: r.plan?.status.knowledgeBase.searched ?? false,
    usedLive: r.plan?.status.liveSearch.used ?? false,
    liveConfigured: features.liveSearch,
    redacted: r.done?.redacted ?? [],
    error: r.error,
  };
  const checks = deterministicChecks(c, o);
  let judged: JudgeOutput | null = null;
  if (useJudge && o.answer) {
    try {
      judged = await judge(anthropic, c, history, question, o);
    } catch (err) {
      checks.push({ name: "judge_ran", passed: false, detail: err instanceof Error ? err.message : String(err) });
    }
  }
  const { passed, failures } = passFromScores(c, checks, judged);
  return { id: c.id, category: c.category, passed, failures, checks, judge: judged, answer: o.answer, sources: o.sources, usedKb: o.usedKb, usedLive: o.usedLive, manual: null };
}

function previousRun(): RunFile | null {
  const files = readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) return null;
  return JSON.parse(readFileSync(path.join(RESULTS_DIR, files[files.length - 1]), "utf8"));
}

function report(run: RunFile, prev: RunFile | null): string {
  const passed = run.results.filter((r) => r.passed).length;
  const lines = [
    `# ZecWise evaluation — ${run.runAt}`,
    "",
    `Model \`${run.model}\` · prompt \`${run.promptVersion}\` · judge \`${run.judgeModel ?? "none"}\` · dataset \`${run.datasetVersion}\` · commit \`${run.gitSha ?? "unknown"}\``,
    `Retrieval: knowledge base ${run.features.database ? "on" : "off"}, live search ${run.features.liveSearch ? run.features.liveSearchProvider : "off"}, embeddings ${run.features.semanticSearch ? "on" : "off"}`,
    "",
    `**Automated result: ${passed}/${run.results.length} cases passed.** These are automated checks and model-judge scores. They are not manual verification, and a passing run does not make the system production-ready.`,
    "",
  ];
  const byCat = new Map<string, CaseResult[]>();
  for (const r of run.results) byCat.set(r.category, [...(byCat.get(r.category) ?? []), r]);
  lines.push("| Category | Passed |", "| --- | --- |");
  for (const [cat, rs] of byCat) lines.push(`| ${cat} | ${rs.filter((r) => r.passed).length}/${rs.length} |`);
  if (prev) {
    const before = new Map(prev.results.map((r) => [r.id, r.passed]));
    const regressions = run.results.filter((r) => before.get(r.id) === true && !r.passed).map((r) => r.id);
    const fixed = run.results.filter((r) => before.get(r.id) === false && r.passed).map((r) => r.id);
    lines.push("", `Compared with ${prev.runAt} (model \`${prev.model}\`, prompt \`${prev.promptVersion}\`): ${regressions.length} regression(s)${regressions.length ? ` — ${regressions.join(", ")}` : ""}; ${fixed.length} fixed${fixed.length ? ` — ${fixed.join(", ")}` : ""}.`);
  }
  const failures = run.results.filter((r) => !r.passed);
  if (failures.length) {
    lines.push("", "## Unresolved failures", "");
    for (const r of failures) lines.push(`- **${r.id}** (${r.category}): ${r.failures.join("; ")}`);
  }
  lines.push("", "## Manual verification", "", "No case in this run has been manually verified unless listed here. Record reviews with `npm run eval -- --review <file> <caseId> pass|fail \"notes\"`.", "");
  for (const r of run.results.filter((x) => x.manual)) lines.push(`- ${r.id}: manually marked **${r.manual!.verdict}** — ${r.manual!.notes}`);
  return lines.join("\n");
}

async function persist(run: RunFile) {
  if (!process.env.DATABASE_URL) return;
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    "insert into eval_runs (model, prompt_version, git_sha, dataset_version, summary) values ($1, $2, $3, $4, $5) returning id",
    [run.model, run.promptVersion, run.gitSha, run.datasetVersion, JSON.stringify({ passed: run.results.filter((r) => r.passed).length, total: run.results.length, judgeModel: run.judgeModel, features: run.features })],
  );
  for (const r of run.results) {
    await pool.query(
      "insert into eval_results (run_id, case_id, category, passed, scores, failures, answer, sources) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [rows[0].id, r.id, r.category, r.passed, JSON.stringify(r.judge?.scores ?? []), JSON.stringify(r.failures), r.answer, JSON.stringify(r.sources)],
    );
  }
  await pool.end();
}

async function review() {
  const [file, caseId, verdict, ...notes] = process.argv.slice(process.argv.indexOf("--review") + 1);
  if (!file || !caseId || !["pass", "fail"].includes(verdict)) throw new Error('Usage: --review <results file> <caseId> pass|fail "notes"');
  const full = path.isAbsolute(file) ? file : path.join(RESULTS_DIR, path.basename(file));
  const run: RunFile = JSON.parse(readFileSync(full, "utf8"));
  const r = run.results.find((x) => x.id === caseId);
  if (!r) throw new Error(`No case ${caseId} in ${full}`);
  r.manual = { verdict: verdict as "pass" | "fail", notes: notes.join(" "), at: new Date().toISOString() };
  writeFileSync(full, JSON.stringify(run, null, 2));
  writeFileSync(full.replace(/\.json$/, ".md"), report(run, null));
  console.log(`Recorded manual ${verdict} for ${caseId}`);
}

async function main() {
  if (process.argv.includes("--review")) return review();
  if (!config.llm.apiKey) throw new Error("ANTHROPIC_API_KEY is required: evals run the real pipeline.");
  const dataset = Dataset.parse(JSON.parse(readFileSync(path.join(process.cwd(), "evals", "dataset.json"), "utf8")));
  const only = arg("--case")?.split(",");
  const category = arg("--category");
  const useJudge = !process.argv.includes("--no-judge");
  const cases = dataset.cases.filter((c) => (!only || only.includes(c.id)) && (!category || c.category === category));
  const anthropic = new Anthropic({ apiKey: config.llm.apiKey });
  console.log(`Running ${cases.length} case(s) against ${config.llm.model} (prompt ${PROMPT_VERSION})${useJudge ? `, judged by ${JUDGE_MODEL}` : ""}. This uses API credits.`);

  const results: CaseResult[] = [];
  for (const c of cases) {
    process.stdout.write(`- ${c.id} … `);
    try {
      const r = await runCase(anthropic, c, useJudge);
      results.push(r);
      console.log(r.passed ? "pass" : `FAIL: ${r.failures.join("; ")}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ id: c.id, category: c.category, passed: false, failures: [`runner_error (${message})`], checks: [], judge: null, answer: "", sources: [], usedKb: false, usedLive: false });
      console.log(`ERROR: ${message}`);
    }
  }

  const run: RunFile = {
    runAt: new Date().toISOString(),
    model: config.llm.model,
    judgeModel: useJudge ? JUDGE_MODEL : null,
    promptVersion: PROMPT_VERSION,
    gitSha: gitSha(),
    datasetVersion: dataset.version,
    features: featureStatus(),
    results,
  };
  const prev = previousRun();
  const stamp = run.runAt.replace(/[:.]/g, "-");
  writeFileSync(path.join(RESULTS_DIR, `${stamp}.json`), JSON.stringify(run, null, 2));
  const md = report(run, prev);
  writeFileSync(path.join(RESULTS_DIR, `${stamp}.md`), md);
  await persist(run).catch((err) => console.warn("Could not store results in the database:", err.message));
  console.log(`\n${md}\n\nSaved evals/results/${stamp}.json`);
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
