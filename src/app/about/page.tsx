import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

export const metadata = { title: "How ZecWise works" };

export default function About() {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="bg-forest-900 px-6 py-4">
        <Link href="/" className="inline-block">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-charcoal">How ZecWise works</h1>
        <div className="prose-zw mt-6">
          <p>
            ZecWise answers questions about Zcash and anything else you want to talk about. For Zcash questions it looks things up before answering, and every
            citation in an answer links to a source that was actually retrieved for that answer.
          </p>
          <h2>Where answers come from</h2>
          <ul>
            <li>
              <strong>A curated knowledge base</strong> of public Zcash documentation, specifications, release notes and community feeds, ingested with
              permission rules (robots.txt, rate limits) respected. Each source is labelled official, primary, reputable, community or unverified.
            </li>
            <li>
              <strong>Live web search</strong> through an authorised search API, used when a question depends on recent information such as releases,
              upgrades or news.
            </li>
            <li>
              <strong>The model&apos;s general knowledge</strong>, clearly flagged when an answer goes beyond what the retrieved sources say.
            </li>
          </ul>
          <h2>What ZecWise will never do</h2>
          <ul>
            <li>Invent a source, link, quote or date. Citation markers are checked against the retrieved sources and unknown ones are removed.</li>
            <li>Claim it searched the web when it didn&apos;t.</li>
            <li>Ask for your seed phrase, private keys or passwords. If you paste something that looks like one, it is removed before processing.</li>
            <li>Promise absolute privacy or give financial advice.</li>
          </ul>
          <h2>Limits</h2>
          <p>
            AI answers can be wrong. Treat ZecWise as a research guide, check important details against the linked sources, and confirm wallet steps in the
            wallet&apos;s own documentation before moving funds.
          </p>
        </div>
        <Link href="/" className="mt-10 inline-flex rounded-lg bg-forest-700 px-4 py-2 text-sm font-medium text-white hover:bg-forest-800">
          Ask ZecWise a question
        </Link>
      </main>
    </div>
  );
}
