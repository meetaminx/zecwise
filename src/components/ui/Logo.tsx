export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  // A shield enclosing a stylised "Z": privacy plus guidance, without crypto clichés.
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M16 2.5 4.5 6.8v8.4c0 7.1 4.9 12.6 11.5 14.3 6.6-1.7 11.5-7.2 11.5-14.3V6.8L16 2.5Z" fill="currentColor" opacity="0.14" />
      <path d="M16 2.5 4.5 6.8v8.4c0 7.1 4.9 12.6 11.5 14.3 6.6-1.7 11.5-7.2 11.5-14.3V6.8L16 2.5Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M11 11h10l-10 10h10" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ tone = "light" }: { tone?: "light" | "dark" }) {
  return (
    <span className={`flex items-center gap-2.5 ${tone === "light" ? "text-white" : "text-forest-800"}`}>
      <LogoMark />
      <span className="font-display text-[1.2rem] font-semibold tracking-tight">ZecWise</span>
    </span>
  );
}
