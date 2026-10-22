import { LogoMark } from "@/components/ui/Logo";

export const STARTER_QUESTIONS = [
  "What is Zcash, and how does it work?",
  "Explain shielded transactions like I'm a beginner.",
  "How do I choose a Zcash wallet?",
  "How is Zcash different from Bitcoin and Monero?",
  "What applications are being built in the Zcash ecosystem?",
];

export function EmptyState({ onPick, disabled }: { onPick: (q: string) => void; disabled: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 pt-[12vh] pb-8 text-center">
      <LogoMark className="h-11 w-11 text-forest-700" />
      <h1 className="mt-5 font-display text-3xl font-semibold tracking-tight text-charcoal sm:text-[2.1rem]">Your guide to everything Zcash.</h1>
      <p className="mt-3 max-w-md text-[0.95rem] leading-relaxed text-muted">
        Ask about privacy, wallets, the protocol or the ecosystem. Answers link to the sources they come from.
      </p>
      <div className="mt-9 grid w-full gap-2.5 sm:grid-cols-2">
        {STARTER_QUESTIONS.map((q, i) => (
          <button
            key={q}
            onClick={() => onPick(q)}
            disabled={disabled}
            className={`rounded-xl border border-line bg-surface px-4 py-3.5 text-left text-sm leading-snug text-ink shadow-[0_1px_0_rgba(20,53,40,0.03)] transition hover:border-forest-600/40 hover:bg-leaf-faint disabled:cursor-not-allowed disabled:opacity-60 ${i === STARTER_QUESTIONS.length - 1 ? "sm:col-span-2" : ""}`}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
