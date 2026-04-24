"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import { createClient } from "@/lib/supabase/client";

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-inter-tight",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
});

const STRENGTH_LABELS = [
  "AWAITING INPUT",
  "WEAK",
  "FAIR",
  "STRONG",
  "EXCELLENT",
] as const;

const scorePassword = (v: string): number => {
  let s = 0;
  if (v.length >= 8) s++;
  if (v.length >= 12) s++;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++;
  if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) s++;
  return s;
};

export default function SignupPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [terms, setTerms] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const score = password ? scorePassword(password) : 0;
  const meterLabel = STRENGTH_LABELS[score];

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError("");
    setMessage("");

    if (!email.trim() || !password) {
      setError("Enter an email and password to continue.");
      return;
    }
    if (!terms) {
      setError("Please accept the Terms and Privacy Policy.");
      return;
    }

    setLoading(true);
    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }
    setMessage(
      "Workspace request received. Check your inbox for a verification link, then sign in.",
    );
    setLoading(false);
    setTimeout(() => router.push("/login"), 1600);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void handleSubmit();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, password, terms]);

  return (
    <div
      className={`${interTight.variable} ${jetbrainsMono.variable} boss-signup`}
    >
      <style>{SIGNUP_CSS}</style>

      <header className="topbar">
        <Link href="/" className="brand" aria-label="BOSS">
          <Image
            src="/boss-logo.png"
            alt="BOSS"
            width={1172}
            height={473}
            priority
            unoptimized
            className="brand-logo"
          />
        </Link>
        <nav>
          <a href="#">Product</a>
          <a href="#">Agents</a>
          <a href="#">Pricing</a>
          <a href="#">Docs</a>
          <Link href="/login" className="signin">
            Sign in →
          </Link>
        </nav>
      </header>

      <main className="stage">
        <div className="bento">
          {/* FORM */}
          <section className="tile t-form">
            <form onSubmit={handleSubmit} className="form-inner">
              <div className="form-head">
                <div>
                  <div className="eyebrow">
                    <span className="dot" />
                    Create account
                  </div>
                  <h2 className="form-title">
                    Put your
                    <br />
                    business on autopilot.
                  </h2>
                  <p className="form-sub">
                    Free during private beta. No credit card. 2-minute setup.
                  </p>
                </div>
                <span className="badge">v2.4 · Beta</span>
              </div>

              <div className="social" aria-label="Social sign-in (coming soon)">
                {SOCIAL_BUTTONS.map((b) => (
                  <button
                    key={b.label}
                    type="button"
                    disabled
                    aria-label={`Continue with ${b.label} (coming soon)`}
                    title="Coming soon"
                  >
                    {b.icon}
                    {b.label}
                  </button>
                ))}
              </div>

              <div className="divider">OR CONTINUE WITH EMAIL</div>

              <div className="field">
                <label htmlFor="email">Work email</label>
                <div className="input-wrap">
                  <input
                    id="email"
                    type="email"
                    placeholder="you@company.com"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="password">Password</label>
                <div className="input-wrap">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Minimum 10 characters"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <span
                    className="trailing"
                    onClick={() => setShowPassword((v) => !v)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ")
                        setShowPassword((v) => !v);
                    }}
                  >
                    {showPassword ? "hide" : "show"}
                  </span>
                </div>
                <div className="meter">
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className={i < score ? "on" : ""} />
                  ))}
                </div>
                <div className="meta-row">
                  <span>STRENGTH — {meterLabel}</span>
                  <span>10+ CHARS · SYMBOL · NUMBER</span>
                </div>
              </div>

              <label className="check">
                <input
                  type="checkbox"
                  checked={terms}
                  onChange={(e) => setTerms(e.target.checked)}
                />
                <span>
                  I agree to the <a href="#">Terms</a> and{" "}
                  <a href="#">Privacy Policy</a>, and consent to receive product
                  updates from BOSS.
                </span>
              </label>

              {error && <p className="form-error">{error}</p>}
              {message && <p className="form-message">{message}</p>}

              <button
                type="submit"
                className="submit"
                disabled={loading}
                aria-busy={loading}
              >
                <span>
                  {loading ? "Creating workspace…" : "Create my workspace"}
                </span>
                <span className="arrow">⌘ + ↵</span>
              </button>

              <div className="form-foot">
                Already running BOSS? <Link href="/login">Sign in instead</Link>
              </div>
            </form>
          </section>

          {/* HERO */}
          <section className="tile t-hero t-photo">
            <div className="photo-overlay" />
            <div className="photo-streak" />
            <div className="photo-content">
              <div className="hero-top">
                <span className="pill pill-light">
                  <span className="dot-green" />
                  Private Beta · 2,847 small businesses
                </span>
                <div className="glyph glyph-light" aria-hidden="true">
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                    <rect
                      x="3"
                      y="3"
                      width="9"
                      height="9"
                      rx="1.5"
                      stroke="rgba(255,253,249,0.55)"
                      strokeWidth="1.2"
                    />
                    <rect
                      x="16"
                      y="3"
                      width="9"
                      height="9"
                      rx="1.5"
                      stroke="rgba(255,253,249,0.55)"
                      strokeWidth="1.2"
                    />
                    <rect
                      x="3"
                      y="16"
                      width="9"
                      height="9"
                      rx="1.5"
                      stroke="rgba(255,253,249,0.55)"
                      strokeWidth="1.2"
                    />
                    <rect
                      x="16"
                      y="16"
                      width="9"
                      height="9"
                      rx="1.5"
                      fill="rgba(255,253,249,0.55)"
                    />
                  </svg>
                </div>
              </div>
              <h1 className="hero-title hero-title-light">
                The operating layer
                <br />
                for <em>your entire</em> shop floor.
              </h1>
              <div className="hero-bottom">
                <div className="hero-meta hero-meta-light">
                  <b>BOSS</b> connects hiring, marketing, sales and paperwork
                  <br />
                  into one agentic workspace — built for owners, not
                  enterprises.
                </div>
              </div>
            </div>
          </section>

          {/* STATS */}
          <section className="tile t-stats t-terminal">
            <div className="term-chrome" aria-hidden="true">
              <span className="term-dot term-red" />
              <span className="term-dot term-yellow" />
              <span className="term-dot term-green" />
              <span className="term-title-bar">boss — stats</span>
            </div>
            <div className="term-body">
              <div className="term-line">
                <span className="term-dim">$ </span>throughput --avg
              </div>
              <div
                className="term-line term-g"
                style={{
                  fontSize: "20px",
                  fontWeight: 400,
                  lineHeight: 1.1,
                  margin: "4px 0",
                }}
              >
                14
                <span style={{ fontSize: "11px", opacity: 0.65 }}> hrs/wk</span>
              </div>
              <div className="term-line term-dim" style={{ fontSize: "10px" }}>
                median · 30 days
              </div>
              <div className="term-sparkline" aria-hidden="true">
                {[28, 45, 58, 72, 62, 88, 78, 100].map((h, i) => (
                  <span key={i} style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
          </section>

          {/* AGENTS */}
          <section className="tile t-agents tint-pink">
            <div className="eyebrow">
              <span className="dot" />
              Agent roster
            </div>
            <h3>
              Hire specialists,
              <br />
              not headcount.
            </h3>
            <div className="agent-list">
              {AGENTS.map((a) => (
                <div className="agent-row" key={a.code}>
                  <div className="avatar">{a.code}</div>
                  <span className="name">{a.name}</span>
                  <span className="role">{a.status}</span>
                  <span
                    className={`status ${a.status === "live" ? "" : "idle"}`}
                  />
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

const SOCIAL_BUTTONS = [
  {
    label: "Google",
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d="M21.6 12.23c0-.68-.06-1.36-.18-2.02H12v3.83h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.23c1.9-1.74 2.99-4.31 2.99-7.33z"
          fill="#4285F4"
        />
        <path
          d="M12 22c2.7 0 4.96-.9 6.61-2.44l-3.23-2.5c-.9.6-2.05.95-3.38.95-2.6 0-4.8-1.76-5.59-4.12H3.07v2.58A9.99 9.99 0 0 0 12 22z"
          fill="#34A853"
        />
        <path
          d="M6.41 13.89A5.99 5.99 0 0 1 6.1 12c0-.66.11-1.3.31-1.89V7.53H3.07a10 10 0 0 0 0 8.94l3.34-2.58z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.99c1.47 0 2.79.5 3.83 1.5l2.86-2.86A9.96 9.96 0 0 0 12 2 9.99 9.99 0 0 0 3.07 7.53l3.34 2.58C7.2 7.75 9.4 5.99 12 5.99z"
          fill="#EA4335"
        />
      </svg>
    ),
  },
  {
    label: "Apple",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M16.37 12.62c-.03-2.78 2.27-4.12 2.37-4.18-1.29-1.89-3.31-2.15-4.03-2.18-1.71-.17-3.35 1.01-4.22 1.01-.89 0-2.22-.99-3.65-.96-1.87.03-3.61 1.09-4.58 2.77-1.96 3.4-.5 8.43 1.41 11.2.94 1.36 2.05 2.88 3.5 2.83 1.41-.06 1.94-.91 3.64-.91 1.69 0 2.17.91 3.65.88 1.51-.03 2.46-1.38 3.38-2.75 1.07-1.58 1.51-3.11 1.53-3.19-.03-.01-2.93-1.13-2.96-4.48zM13.62 4.67c.78-.94 1.3-2.25 1.16-3.55-1.12.05-2.48.75-3.28 1.69-.72.83-1.35 2.16-1.18 3.43 1.25.1 2.52-.63 3.3-1.57z" />
      </svg>
    ),
  },
  {
    label: "GitHub",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 .5C5.73.5.5 5.73.5 12a11.5 11.5 0 0 0 7.86 10.94c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.16.08 1.76 1.19 1.76 1.19 1.02 1.75 2.68 1.25 3.34.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.08-.12-.3-.52-1.47.11-3.07 0 0 .97-.31 3.18 1.18a11.06 11.06 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.6.23 2.77.11 3.07.74.8 1.19 1.82 1.19 3.08 0 4.41-2.69 5.38-5.25 5.66.41.36.78 1.06.78 2.14v3.18c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z" />
      </svg>
    ),
  },
];

const AGENTS = [
  { code: "RC", name: "Recruitment", status: "live" },
  { code: "MK", name: "Marketing", status: "live" },
  { code: "SL", name: "Sales", status: "live" },
  { code: "DC", name: "Documents", status: "idle" },
];

const SIGNUP_CSS = `
.boss-signup {
  --bg: #f5f1ea;
  --bg-tile: #ffffff;
  --bg-tile-2: #f5f1ea;
  --ink: #2a2724;
  --ink-2: #1a1816;
  --muted: #7a746c;
  --muted-2: #a8a39a;
  --line: #e6e1d8;
  --line-strong: #d4cec3;
  --accent: #2a2724;
  --accent-ink: #fffdf9;
  --field-bg: #ffffff;
  --hover: #faf7f1;
  --shadow: 0 1px 0 rgba(0,0,0,0.02), 0 1px 2px rgba(0,0,0,0.03);
  --radius: 5px;
  --radius-sm: 10px;
  --font-sans: var(--font-inter-tight), system-ui, sans-serif;
  --font-mono: var(--font-jetbrains-mono), ui-monospace, monospace;

  --tint-pink: #f4dbd9;
  --tint-peach: #f1d9c7;
  --tint-lavender: #d9d4e6;
  --tint-mauve: #e5d5db;
  --tint-sage: #cfd9cc;
  --tint-mint: #c6dad1;
  --tint-sky: #c9d7dc;
  --tint-butter: #eee3c4;

  --tint-pink-ink: #8a4e49;
  --tint-peach-ink: #8a5a3a;
  --tint-lavender-ink: #4e4970;
  --tint-mauve-ink: #764957;
  --tint-sage-ink: #4a5a46;
  --tint-mint-ink: #3e6659;
  --tint-sky-ink: #41606b;
  --tint-butter-ink: #7a6131;

  font-family: var(--font-sans);
  background: var(--bg);
  color: var(--ink);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
  letter-spacing: -0.01em;
  position: relative;
  isolation: isolate;
}
.boss-signup, .boss-signup * { box-sizing: border-box; }

.boss-signup .topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 22px 40px;
  max-width: 1440px;
  margin: 0 auto;
}
.boss-signup .brand {
  display: flex;
  align-items: center;
  color: var(--ink);
  text-decoration: none;
  transition: opacity .15s;
}
.boss-signup .brand:hover { opacity: 0.8; }
.boss-signup .brand .brand-logo {
  height: 32px;
  width: auto;
}
.boss-signup .topbar nav {
  display: flex;
  align-items: center;
  gap: 28px;
  font-size: 13px;
  color: var(--muted);
}
.boss-signup .topbar nav a {
  color: var(--muted);
  text-decoration: none;
  transition: color .15s;
}
.boss-signup .topbar nav a:hover { color: var(--ink); }
.boss-signup .topbar .signin { color: var(--ink); font-weight: 500; }

.boss-signup .stage {
  max-width: 1440px;
  margin: 0 auto;
  padding: 8px 40px 40px;
}
.boss-signup .bento {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  grid-auto-rows: 116px;
  gap: 14px;
}

.boss-signup .tile {
  background: var(--bg-tile);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 24px;
  position: relative;
  overflow: hidden;
  transition: border-color .2s, background .2s;
}
.boss-signup .tile.alt { background: var(--bg-tile-2); }
.boss-signup .tile.tint-pink     { background: var(--tint-pink);     border-color: transparent; }
.boss-signup .tile.tint-peach    { background: var(--tint-peach);    border-color: transparent; }
.boss-signup .tile.tint-lavender { background: var(--tint-lavender); border-color: transparent; }
.boss-signup .tile.tint-mauve    { background: var(--tint-mauve);    border-color: transparent; }
.boss-signup .tile.tint-sage     { background: var(--tint-sage);     border-color: transparent; }
.boss-signup .tile.tint-mint     { background: var(--tint-mint);     border-color: transparent; }
.boss-signup .tile.tint-sky      { background: var(--tint-sky);      border-color: transparent; }
.boss-signup .tile.tint-butter   { background: var(--tint-butter);   border-color: transparent; }

.boss-signup .tile.tint-pink     .eyebrow, .boss-signup .tile.tint-pink     h3 { color: var(--tint-pink-ink); }
.boss-signup .tile.tint-peach    .eyebrow, .boss-signup .tile.tint-peach    h3 { color: var(--tint-peach-ink); }
.boss-signup .tile.tint-lavender .eyebrow, .boss-signup .tile.tint-lavender h3 { color: var(--tint-lavender-ink); }
.boss-signup .tile.tint-mauve    .eyebrow, .boss-signup .tile.tint-mauve    h3 { color: var(--tint-mauve-ink); }
.boss-signup .tile.tint-sage     .eyebrow, .boss-signup .tile.tint-sage     h3 { color: var(--tint-sage-ink); }
.boss-signup .tile.tint-mint     .eyebrow, .boss-signup .tile.tint-mint     h3 { color: var(--tint-mint-ink); }
.boss-signup .tile.tint-sky      .eyebrow, .boss-signup .tile.tint-sky      h3 { color: var(--tint-sky-ink); }
.boss-signup .tile.tint-butter   .eyebrow, .boss-signup .tile.tint-butter   h3 { color: var(--tint-butter-ink); }

.boss-signup .tile[class*="tint-"] p { color: color-mix(in oklab, currentColor 65%, transparent); }
.boss-signup .tile[class*="tint-"] .eyebrow { color: color-mix(in oklab, currentColor 70%, transparent); }

.boss-signup .tile .eyebrow {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 8px;
}
.boss-signup .tile .eyebrow .dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: currentColor;
  opacity: .7;
}
.boss-signup .tile[class*="tint-"] .agent-row {
  background: color-mix(in oklab, #fff 35%, transparent);
  border-color: color-mix(in oklab, currentColor 15%, transparent);
}
.boss-signup .tile[class*="tint-"] .agent-row .name { color: inherit; }
.boss-signup .tile[class*="tint-"] .agent-row .avatar { background: currentColor; color: var(--bg-tile); }
.boss-signup .tile[class*="tint-"] .agent-row .status { background: currentColor; }
.boss-signup .tile[class*="tint-"] .agent-row .status.idle { background: color-mix(in oklab, currentColor 40%, transparent); }
.boss-signup .tile[class*="tint-"] .pill { border-color: color-mix(in oklab, currentColor 25%, transparent); color: inherit; }
.boss-signup .tile[class*="tint-"] .pill .dot { background: currentColor; }
.boss-signup .tile[class*="tint-"] .glyph { border-color: color-mix(in oklab, currentColor 25%, transparent); color: inherit; }
.boss-signup .tile[class*="tint-"] .hero-meta { color: color-mix(in oklab, currentColor 75%, transparent); }
.boss-signup .tile[class*="tint-"] .hero-meta b { color: inherit; }
.boss-signup .tile[class*="tint-"] .hero-title { color: inherit; }
.boss-signup .tile[class*="tint-"] .hero-title em {
  color: var(--tint-mint-ink);
  font-style: italic;
  font-family: var(--font-sans), serif;
}
.boss-signup .tile h3 {
  margin: 14px 0 0;
  font-weight: 500;
  font-size: 22px;
  line-height: 1.2;
  letter-spacing: -0.02em;
  color: var(--ink);
}
.boss-signup .tile p {
  margin: 10px 0 0;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--muted);
}

.boss-signup .t-form     { grid-column: span 5; grid-row: span 6; padding: 32px; display: flex; flex-direction: column; }
.boss-signup .t-hero     { grid-column: span 7; grid-row: span 3; }
.boss-signup .t-stats    { grid-column: span 3; grid-row: span 3; }
.boss-signup .t-agents   { grid-column: span 4; grid-row: span 3; }

.boss-signup .form-inner { display: flex; flex-direction: column; flex: 1; min-height: 0; }

.boss-signup .form-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.boss-signup .form-head .badge {
  font-family: var(--font-mono);
  font-size: 10.5px;
  padding: 5px 10px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  color: var(--muted);
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.boss-signup .form-title {
  margin: 18px 0 6px;
  font-size: 32px;
  font-weight: 500;
  letter-spacing: -0.03em;
  line-height: 1.08;
  color: var(--ink);
}
.boss-signup .form-sub {
  margin: 0 0 24px;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.5;
}

.boss-signup .social {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
  margin-bottom: 18px;
}
.boss-signup .social button {
  background: var(--field-bg);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 11px 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  color: var(--ink);
  cursor: not-allowed;
  opacity: 0.55;
  transition: opacity .15s;
}
.boss-signup .social button:hover { opacity: 0.75; }
.boss-signup .social svg { width: 16px; height: 16px; }

.boss-signup .divider {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  margin: 4px 0 16px;
}
.boss-signup .divider::before,
.boss-signup .divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--line);
}

.boss-signup .field { margin-bottom: 12px; }
.boss-signup .field label {
  display: block;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 6px;
}
.boss-signup .input-wrap { position: relative; }
.boss-signup .input-wrap input {
  width: 100%;
  background: var(--field-bg);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 13px 14px;
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--ink);
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.boss-signup .input-wrap input:focus {
  border-color: var(--ink);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ink) 8%, transparent);
}
.boss-signup .input-wrap input::placeholder { color: var(--muted-2); }
.boss-signup .input-wrap .trailing {
  position: absolute;
  right: 12px; top: 50%;
  transform: translateY(-50%);
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 11px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  user-select: none;
}
.boss-signup .input-wrap .trailing:hover { background: var(--hover); }

.boss-signup .meter { display: flex; gap: 4px; margin-top: 8px; }
.boss-signup .meter span {
  height: 3px;
  flex: 1;
  background: var(--line);
  border-radius: 2px;
  transition: background .15s;
}
.boss-signup .meter span.on { background: var(--ink); }

.boss-signup .meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--muted);
  letter-spacing: 0.04em;
}

.boss-signup .check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 16px 0 18px;
  font-size: 12.5px;
  color: var(--muted);
  line-height: 1.5;
}
.boss-signup .check input {
  margin-top: 2px;
  appearance: none;
  width: 15px; height: 15px;
  border: 1px solid var(--line-strong);
  border-radius: 4px;
  cursor: pointer;
  background: var(--field-bg);
  display: grid; place-items: center;
  flex-shrink: 0;
}
.boss-signup .check input:checked {
  background: var(--ink);
  border-color: var(--ink);
}
.boss-signup .check input:checked::after {
  content: "";
  width: 7px; height: 4px;
  border-left: 1.5px solid var(--bg);
  border-bottom: 1.5px solid var(--bg);
  transform: rotate(-45deg) translate(1px, -1px);
}
.boss-signup .check a {
  color: var(--ink);
  text-decoration: none;
  border-bottom: 1px solid var(--line-strong);
}

.boss-signup .form-error {
  margin: 0 0 10px;
  font-size: 12.5px;
  color: #b04a3f;
  font-family: var(--font-mono);
  letter-spacing: 0.02em;
}
.boss-signup .form-message {
  margin: 0 0 10px;
  font-size: 12.5px;
  color: var(--tint-mint-ink);
  font-family: var(--font-mono);
  letter-spacing: 0.02em;
}

.boss-signup .submit {
  width: 100%;
  background: var(--accent);
  color: var(--accent-ink);
  border: none;
  border-radius: 12px;
  padding: 14px;
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 500;
  letter-spacing: -0.005em;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: transform .1s, opacity .15s;
}
.boss-signup .submit:hover { opacity: .92; }
.boss-signup .submit:active { transform: translateY(1px); }
.boss-signup .submit:disabled { opacity: 0.6; cursor: progress; }
.boss-signup .submit .arrow {
  font-family: var(--font-mono);
  font-size: 12px;
  opacity: .7;
}

.boss-signup .form-foot {
  margin-top: auto;
  padding-top: 18px;
  font-size: 12.5px;
  color: var(--muted);
}
.boss-signup .form-foot a {
  color: var(--ink);
  text-decoration: none;
  border-bottom: 1px solid var(--line-strong);
}

.boss-signup .t-hero {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.boss-signup .hero-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.boss-signup .hero-title {
  font-size: 44px;
  line-height: 1.02;
  letter-spacing: -0.035em;
  font-weight: 400;
  margin: 18px 0 0;
  max-width: 560px;
}
.boss-signup .hero-bottom {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 20px;
}
.boss-signup .hero-meta {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted);
  letter-spacing: 0.04em;
  line-height: 1.6;
}
.boss-signup .hero-meta b { color: var(--ink); font-weight: 500; }
.boss-signup .glyph {
  width: 64px; height: 64px;
  border: 1px solid var(--line-strong);
  border-radius: 16px;
  display: grid; place-items: center;
  color: var(--ink);
}

.boss-signup .t-stats {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.boss-signup .agent-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}
.boss-signup .agent-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  background: var(--bg-tile-2);
  border-radius: 10px;
  font-size: 12.5px;
}
.boss-signup .agent-row .avatar {
  width: 20px; height: 20px;
  border-radius: 6px;
  background: var(--ink);
  color: var(--bg);
  display: grid; place-items: center;
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 600;
  flex-shrink: 0;
}
.boss-signup .agent-row .name { font-weight: 500; color: var(--ink); }
.boss-signup .agent-row .role { color: var(--muted); margin-left: auto; font-family: var(--font-mono); font-size: 10.5px; }
.boss-signup .agent-row .status {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--ink);
  margin-left: 6px;
}
.boss-signup .agent-row .status.idle { background: var(--muted-2); }

.boss-signup .pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--muted);
  padding: 5px 10px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  letter-spacing: 0.04em;
}
.boss-signup .pill .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ink); }

@media (max-width: 1200px) {
  .boss-signup .bento { grid-template-columns: repeat(6, 1fr); grid-auto-rows: 120px; }
  .boss-signup .t-form { grid-column: span 6; grid-row: span 6; }
  .boss-signup .t-hero { grid-column: span 6; grid-row: span 3; }
  .boss-signup .t-stats,
  .boss-signup .t-agents { grid-column: span 3; }
}
@media (max-width: 720px) {
  .boss-signup .topbar { padding: 18px 20px; }
  .boss-signup .topbar nav { display: none; }
  .boss-signup .stage { padding: 0 16px 24px; }
  .boss-signup .bento { grid-template-columns: repeat(2, 1fr); }
  .boss-signup .t-form,
  .boss-signup .t-hero,
  .boss-signup .t-stats,
  .boss-signup .t-agents { grid-column: span 2; }
  .boss-signup .form-title { font-size: 26px; }
  .boss-signup .hero-title { font-size: 32px; }
}

/* Photo background tile */
.boss-signup .t-photo {
  background: radial-gradient(ellipse at 75% 35%, #5a4030 0%, #3a2818 40%, #1c1008 100%);
  border-color: transparent;
  padding: 0;
  display: block;
}
.boss-signup .t-photo::before {
  content: '';
  position: absolute; inset: 0;
  background:
    radial-gradient(ellipse at 15% 85%, rgba(190,140,85,0.2) 0%, transparent 50%),
    radial-gradient(ellipse at 85% 15%, rgba(230,180,100,0.12) 0%, transparent 45%);
  pointer-events: none;
}
.boss-signup .photo-overlay {
  position: absolute; inset: 0;
  background: linear-gradient(to right, rgba(16,10,6,0.75) 0%, rgba(16,10,6,0.35) 55%, rgba(16,10,6,0.08) 100%);
  z-index: 0;
}
.boss-signup .photo-streak {
  position: absolute; top: -30%; right: 18%;
  width: 160px; height: 200%;
  background: linear-gradient(168deg, rgba(255,200,100,0.07) 0%, transparent 55%);
  transform: rotate(12deg);
  pointer-events: none; z-index: 0;
}
.boss-signup .photo-content {
  position: relative; z-index: 1;
  padding: 24px; height: 100%;
  display: flex; flex-direction: column; justify-content: space-between;
}
.boss-signup .pill-light {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-mono); font-size: 10.5px;
  color: rgba(255,253,249,0.65);
  padding: 5px 10px;
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 999px; letter-spacing: 0.04em;
}
.boss-signup .dot-green {
  width: 6px; height: 6px; border-radius: 50%;
  background: #28c840; flex-shrink: 0;
}
.boss-signup .glyph-light { border-color: rgba(255,255,255,0.15); }
.boss-signup .hero-title-light { color: #fffdf9; }
.boss-signup .hero-title-light em {
  color: rgba(255,218,150,0.88);
  font-style: italic;
}
.boss-signup .hero-meta-light { color: rgba(255,253,249,0.42); }
.boss-signup .hero-meta-light b { color: rgba(255,253,249,0.6); }

/* Terminal tile */
.boss-signup .t-terminal {
  background: #1a1816;
  border-color: transparent;
  padding: 0;
  display: flex; flex-direction: column; justify-content: flex-start;
}
.boss-signup .term-chrome {
  background: #2a2724;
  padding: 8px 12px;
  display: flex; align-items: center; gap: 6px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  flex-shrink: 0;
  border-radius: var(--radius) var(--radius) 0 0;
}
.boss-signup .term-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.boss-signup .term-red    { background: #ff5f57; }
.boss-signup .term-yellow { background: #febc2e; }
.boss-signup .term-green  { background: #28c840; }
.boss-signup .term-title-bar {
  font-family: var(--font-mono); font-size: 10px;
  color: rgba(255,253,249,0.28); margin-left: 6px;
}
.boss-signup .term-body {
  padding: 12px 14px; flex: 1;
  display: flex; flex-direction: column; justify-content: center;
  line-height: 1.85;
}
.boss-signup .term-line {
  font-family: var(--font-mono); font-size: 11px;
  color: rgba(255,253,249,0.8);
}
.boss-signup .term-g   { color: #28c840; }
.boss-signup .term-y   { color: #febc2e; }
.boss-signup .term-m   { color: rgba(255,253,249,0.42); }
.boss-signup .term-dim { color: rgba(255,253,249,0.3); }
.boss-signup .term-sparkline {
  display: flex; align-items: flex-end; gap: 3px;
  height: 22px; margin-top: 8px;
}
.boss-signup .term-sparkline span {
  flex: 1; border-radius: 1px;
  background: rgba(40, 200, 64, 0.28);
}
.boss-signup .term-sparkline span:last-child {
  background: rgba(40, 200, 64, 0.6);
}
`;
