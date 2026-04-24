"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import { createClient } from "@/lib/supabase/client";
import { PricingPreviewModal } from "@/components/layout/PricingPreviewModal";

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

export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pricingOpen, setPricingOpen] = useState(false);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError("Enter your email and password to continue.");
      return;
    }

    setLoading(true);
    const { data, error: signInError } = await supabase.auth.signInWithPassword(
      {
        email: email.trim(),
        password,
      },
    );
    if (signInError) {
      setError("Email or password is incorrect.");
      setLoading(false);
      return;
    }

    const uid = data.user?.id;
    if (uid) {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL;
        const res = await fetch(`${apiBase}/api/auth/session/touch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: uid }),
        });
        const json = await res.json();
        const briefing = json?.data?.briefing;
        if (briefing?.should_fire && briefing?.message) {
          sessionStorage.setItem("boss2:pending-briefing", briefing.message);
        }
      } catch {
        // briefing failure must not block sign-in
      }
    }

    router.push("/dashboard");
    router.refresh();
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
  }, [email, password, remember]);

  return (
    <div
      className={`${interTight.variable} ${jetbrainsMono.variable} boss-signin`}
    >
      <PricingPreviewModal open={pricingOpen} onClose={() => setPricingOpen(false)} />
      <style>{SIGNIN_CSS}</style>

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
          <a href="#">Docs</a>
          <a href="#">Status</a>
          <button type="button" onClick={() => setPricingOpen(true)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", color: "var(--muted)" }}>Pricing</button>
          <a href="#">Contact</a>
          <Link href="/signup" className="signup">
            Create account →
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
                    Sign in
                  </div>
                  <h2 className="form-title">
                    Pick up where
                    <br />
                    you left off.
                  </h2>
                  <p className="form-sub">
                    Welcome back. Sign in to continue your work.
                  </p>
                </div>
                <span className="badge">SSO · SAML</span>
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

              <div className="divider">OR USE EMAIL</div>

              <div className="field">
                <div className="row">
                  <label htmlFor="email">Work email</label>
                </div>
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
                <div className="row">
                  <label htmlFor="password">Password</label>
                  <a href="#" className="forgot">
                    FORGOT?
                  </a>
                </div>
                <div className="input-wrap">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••••"
                    autoComplete="current-password"
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
              </div>

              <label className="check">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <span>Keep me signed in on this device</span>
              </label>

              {error && <p className="form-error">{error}</p>}

              <button
                type="submit"
                className="submit"
                disabled={loading}
                aria-busy={loading}
              >
                <span>{loading ? "Signing in…" : "Sign in"}</span>
                <span className="arrow">⌘ + ↵</span>
              </button>

              <div className="form-foot">
                New to BOSS? <Link href="/signup">Create a workspace</Link>
              </div>
            </form>
          </section>

          {/* WELCOME */}
          <section className="tile t-welcome t-photo">
            <div className="photo-overlay" />
            <div className="photo-streak" />
            <div className="photo-content">
              <span className="pill pill-light">
                <span className="dot-green" />
                Returning member
              </span>
              <div>
                <h2 className="welcome-title">
                  Welcome
                  <br />
                  <em>back.</em>
                </h2>
                <div className="welcome-meta">
                  <b>BOSS</b> keeps your workspace ready —<br />
                  your agents, schedules and chats are right where you left
                  them.
                </div>
              </div>
            </div>
          </section>

          {/* STATUS */}
          <section className="tile t-status t-terminal">
            <div className="term-chrome" aria-hidden="true">
              <span className="term-dot term-red" />
              <span className="term-dot term-yellow" />
              <span className="term-dot term-green" />
              <span className="term-title-bar">boss — system</span>
            </div>
            <div className="term-body">
              <div className="term-line">
                <span className="term-g">✓</span>{" "}
                <span className="term-m">agents</span>{" "}
                <span className="term-g">OK</span>
              </div>
              <div className="term-line">
                <span className="term-g">✓</span>{" "}
                <span className="term-m">netsuite</span>{" "}
                <span className="term-y">0.8s</span>
              </div>
              <div className="term-line">
                <span className="term-g">✓</span>{" "}
                <span className="term-m">slack</span>{" "}
                <span className="term-g">LIVE</span>
              </div>
              <div className="term-line">
                <span className="term-g">✓</span>{" "}
                <span className="term-m">sso·okta</span>{" "}
                <span className="term-g">OK</span>
              </div>
              <div className="term-line term-prompt">
                <span className="term-dim">$ </span>
                <span className="term-cursor" aria-hidden="true" />
              </div>
            </div>
          </section>

          {/* QUICK */}
          <section className="tile t-quick tint-lavender">
            <div className="eyebrow">
              <span className="dot" />
              Since you left
            </div>
            <div className="quick-big">
              +128<sup>tasks</sup>
            </div>
            <div className="quick-label">
              BOSS handled 128 tasks and saved you roughly 4 hours.
            </div>
            <div className="quick-bars" aria-hidden="true">
              {[30, 48, 38, 65, 55, 80, 72, 100].map((h, i) => (
                <span key={i} style={{ height: `${h}%` }} />
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

const SIGNIN_CSS = `
.boss-signin {
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
  --radius: 5px;
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
.boss-signin, .boss-signin * { box-sizing: border-box; }

.boss-signin .topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 22px 40px;
  max-width: 1440px;
  margin: 0 auto;
}
.boss-signin .brand {
  display: flex;
  align-items: center;
  color: var(--ink);
  text-decoration: none;
  transition: opacity .15s;
}
.boss-signin .brand:hover { opacity: 0.8; }
.boss-signin .brand .brand-logo {
  height: 32px;
  width: auto;
}
.boss-signin .topbar nav {
  display: flex;
  align-items: center;
  gap: 28px;
  font-size: 13px;
  color: var(--muted);
}
.boss-signin .topbar nav a {
  color: var(--muted);
  text-decoration: none;
  transition: color .15s;
}
.boss-signin .topbar nav a:hover { color: var(--ink); }
.boss-signin .topbar .signup { color: var(--ink); font-weight: 500; }

.boss-signin .stage {
  max-width: 1440px;
  margin: 0 auto;
  padding: 8px 40px 40px;
}

.boss-signin .bento {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  grid-auto-rows: 116px;
  gap: 14px;
}

.boss-signin .tile {
  background: var(--bg-tile);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 24px;
  position: relative;
  overflow: hidden;
}

.boss-signin .tile.tint-pink     { background: var(--tint-pink);     border-color: transparent; color: var(--tint-pink-ink); }
.boss-signin .tile.tint-peach    { background: var(--tint-peach);    border-color: transparent; color: var(--tint-peach-ink); }
.boss-signin .tile.tint-lavender { background: var(--tint-lavender); border-color: transparent; color: var(--tint-lavender-ink); }
.boss-signin .tile.tint-mauve    { background: var(--tint-mauve);    border-color: transparent; color: var(--tint-mauve-ink); }
.boss-signin .tile.tint-sage     { background: var(--tint-sage);     border-color: transparent; color: var(--tint-sage-ink); }
.boss-signin .tile.tint-mint     { background: var(--tint-mint);     border-color: transparent; color: var(--tint-mint-ink); }
.boss-signin .tile.tint-sky      { background: var(--tint-sky);      border-color: transparent; color: var(--tint-sky-ink); }
.boss-signin .tile.tint-butter   { background: var(--tint-butter);   border-color: transparent; color: var(--tint-butter-ink); }

.boss-signin .tile[class*="tint-"] h2,
.boss-signin .tile[class*="tint-"] h3 { color: inherit; }
.boss-signin .tile[class*="tint-"] .eyebrow { color: color-mix(in oklab, currentColor 70%, transparent); }
.boss-signin .tile[class*="tint-"] p { color: color-mix(in oklab, currentColor 70%, transparent); }

.boss-signin .tile .eyebrow {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 8px;
}
.boss-signin .tile .eyebrow .dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: currentColor;
  opacity: .7;
}

/* Grid placement */
.boss-signin .t-form    { grid-column: span 5; grid-row: span 6; padding: 32px; display: flex; flex-direction: column; }
.boss-signin .t-welcome { grid-column: span 7; grid-row: span 3; }
.boss-signin .t-status  { grid-column: span 3; grid-row: span 3; }
.boss-signin .t-quick   { grid-column: span 4; grid-row: span 3; }

/* Form */
.boss-signin .form-inner { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.boss-signin .form-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.boss-signin .form-head .badge {
  font-family: var(--font-mono);
  font-size: 10.5px;
  padding: 5px 10px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  color: var(--muted);
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.boss-signin .form-title {
  margin: 16px 0 6px;
  font-size: 30px;
  font-weight: 500;
  letter-spacing: -0.03em;
  line-height: 1.08;
  color: var(--ink);
}
.boss-signin .form-sub {
  margin: 0 0 22px;
  color: var(--muted);
  font-size: 13.5px;
  line-height: 1.5;
}

.boss-signin .social {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
  margin-bottom: 16px;
}
.boss-signin .social button {
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
.boss-signin .social button:hover { opacity: 0.75; }
.boss-signin .social svg { width: 16px; height: 16px; }

.boss-signin .divider {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  margin: 2px 0 14px;
}
.boss-signin .divider::before,
.boss-signin .divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--line);
}

.boss-signin .field { margin-bottom: 12px; }
.boss-signin .field .row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}
.boss-signin .field label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.boss-signin .field .forgot {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--muted);
  text-decoration: none;
  letter-spacing: 0.04em;
}
.boss-signin .field .forgot:hover { color: var(--ink); }

.boss-signin .input-wrap { position: relative; }
.boss-signin .input-wrap input {
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
.boss-signin .input-wrap input:focus {
  border-color: var(--ink);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ink) 8%, transparent);
}
.boss-signin .input-wrap input::placeholder { color: var(--muted-2); }
.boss-signin .input-wrap .trailing {
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
.boss-signin .input-wrap .trailing:hover { background: var(--hover); }

.boss-signin .check {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 14px 0 16px;
  font-size: 12.5px;
  color: var(--muted);
}
.boss-signin .check input {
  appearance: none;
  width: 15px; height: 15px;
  border: 1px solid var(--line-strong);
  border-radius: 4px;
  cursor: pointer;
  background: var(--field-bg);
  display: grid; place-items: center;
  flex-shrink: 0;
}
.boss-signin .check input:checked {
  background: var(--ink);
  border-color: var(--ink);
}
.boss-signin .check input:checked::after {
  content: "";
  width: 7px; height: 4px;
  border-left: 1.5px solid var(--bg);
  border-bottom: 1.5px solid var(--bg);
  transform: rotate(-45deg) translate(1px, -1px);
}

.boss-signin .form-error {
  margin: 0 0 10px;
  font-size: 12.5px;
  color: #b04a3f;
  font-family: var(--font-mono);
  letter-spacing: 0.02em;
}

.boss-signin .submit {
  width: 100%;
  background: var(--accent);
  color: var(--accent-ink);
  border: none;
  border-radius: 12px;
  padding: 14px;
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: opacity .15s, transform .1s;
}
.boss-signin .submit:hover { opacity: .92; }
.boss-signin .submit:active { transform: translateY(1px); }
.boss-signin .submit:disabled { opacity: 0.6; cursor: progress; }
.boss-signin .submit span { white-space: nowrap; }
.boss-signin .submit .arrow {
  font-family: var(--font-mono);
  font-size: 12px;
  opacity: .7;
}

.boss-signin .form-foot {
  margin-top: auto;
  padding-top: 16px;
  font-size: 12.5px;
  color: var(--muted);
}
.boss-signin .form-foot a {
  color: var(--ink);
  text-decoration: none;
  border-bottom: 1px solid var(--line-strong);
}

/* Welcome */
.boss-signin .t-welcome {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.boss-signin .pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: inherit;
  padding: 5px 10px;
  border: 1px solid color-mix(in oklab, currentColor 25%, transparent);
  border-radius: 999px;
  letter-spacing: 0.04em;
}
.boss-signin .pill .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

.boss-signin .welcome-title {
  font-size: 36px;
  line-height: 1.05;
  letter-spacing: -0.03em;
  font-weight: 400;
  margin: 14px 0 0;
  color: inherit;
}
.boss-signin .welcome-title em {
  font-style: italic;
  font-family: var(--font-sans), serif;
  color: var(--tint-mint-ink);
}

.boss-signin .welcome-meta {
  font-family: var(--font-mono);
  font-size: 11px;
  color: color-mix(in oklab, currentColor 70%, transparent);
  line-height: 1.6;
  letter-spacing: 0.02em;
}
.boss-signin .welcome-meta b { color: inherit; font-weight: 500; }

/* Quick */
.boss-signin .t-quick { display: flex; flex-direction: column; justify-content: space-between; }
.boss-signin .quick-big {
  font-size: 38px;
  letter-spacing: -0.03em;
  font-weight: 400;
  line-height: 1;
  margin-top: 8px;
  color: inherit;
}
.boss-signin .quick-big sup {
  font-size: 13px;
  font-family: var(--font-mono);
  color: color-mix(in oklab, currentColor 65%, transparent);
  font-weight: 400;
  vertical-align: super;
  margin-left: 6px;
}
.boss-signin .quick-label {
  font-size: 12px;
  line-height: 1.45;
  color: color-mix(in oklab, currentColor 70%, transparent);
}

@media (max-width: 1200px) {
  .boss-signin .bento { grid-template-columns: repeat(6, 1fr); grid-auto-rows: 120px; }
  .boss-signin .t-form { grid-column: span 6; grid-row: span 6; }
  .boss-signin .t-welcome { grid-column: span 6; grid-row: span 3; }
  .boss-signin .t-status { grid-column: span 3; grid-row: span 2; }
  .boss-signin .t-quick { grid-column: span 3; grid-row: span 2; }
}
@media (max-width: 720px) {
  .boss-signin .topbar { padding: 18px 20px; }
  .boss-signin .topbar nav { display: none; }
  .boss-signin .stage { padding: 0 16px 24px; }
  .boss-signin .bento { grid-template-columns: repeat(2, 1fr); }
  .boss-signin .t-form,
  .boss-signin .t-welcome,
  .boss-signin .t-status,
  .boss-signin .t-quick { grid-column: span 2; }
  .boss-signin .form-title { font-size: 26px; }
  .boss-signin .welcome-title { font-size: 30px; }
}

/* Photo background tile */
.boss-signin .t-photo {
  background: radial-gradient(ellipse at 75% 35%, #5a4030 0%, #3a2818 40%, #1c1008 100%);
  border-color: transparent;
  padding: 0;
  display: block;
}
.boss-signin .t-photo::before {
  content: '';
  position: absolute; inset: 0;
  background:
    radial-gradient(ellipse at 15% 85%, rgba(190,140,85,0.2) 0%, transparent 50%),
    radial-gradient(ellipse at 85% 15%, rgba(230,180,100,0.12) 0%, transparent 45%);
  pointer-events: none;
}
.boss-signin .photo-overlay {
  position: absolute; inset: 0;
  background: linear-gradient(to right, rgba(16,10,6,0.75) 0%, rgba(16,10,6,0.35) 55%, rgba(16,10,6,0.08) 100%);
  z-index: 0;
}
.boss-signin .photo-streak {
  position: absolute; top: -30%; right: 18%;
  width: 160px; height: 200%;
  background: linear-gradient(168deg, rgba(255,200,100,0.07) 0%, transparent 55%);
  transform: rotate(12deg);
  pointer-events: none; z-index: 0;
}
.boss-signin .photo-content {
  position: relative; z-index: 1;
  padding: 24px; height: 100%;
  display: flex; flex-direction: column; justify-content: space-between;
}
.boss-signin .pill-light {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-mono); font-size: 10.5px;
  color: rgba(255,253,249,0.65);
  padding: 5px 10px;
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 999px; letter-spacing: 0.04em;
}
.boss-signin .dot-green {
  width: 6px; height: 6px; border-radius: 50%;
  background: #28c840; flex-shrink: 0;
}
.boss-signin .t-welcome .welcome-title { color: #fffdf9; }
.boss-signin .t-welcome .welcome-title em { color: rgba(255,218,150,0.88); }
.boss-signin .t-welcome .welcome-meta {
  color: rgba(255,253,249,0.38); margin-top: 8px;
}
.boss-signin .t-welcome .welcome-meta b { color: rgba(255,253,249,0.6); }

/* Terminal tile */
.boss-signin .t-terminal {
  background: #1a1816;
  border-color: transparent;
  padding: 0;
  display: flex; flex-direction: column; justify-content: flex-start;
}
.boss-signin .term-chrome {
  background: #2a2724;
  padding: 8px 12px;
  display: flex; align-items: center; gap: 6px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  flex-shrink: 0;
  border-radius: var(--radius) var(--radius) 0 0;
}
.boss-signin .term-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.boss-signin .term-red    { background: #ff5f57; }
.boss-signin .term-yellow { background: #febc2e; }
.boss-signin .term-green  { background: #28c840; }
.boss-signin .term-title-bar {
  font-family: var(--font-mono); font-size: 10px;
  color: rgba(255,253,249,0.28); margin-left: 6px;
}
.boss-signin .term-body {
  padding: 12px 14px; flex: 1;
  display: flex; flex-direction: column; justify-content: center;
  line-height: 1.85;
}
.boss-signin .term-line {
  font-family: var(--font-mono); font-size: 11px;
  color: rgba(255,253,249,0.8);
}
.boss-signin .term-g   { color: #28c840; }
.boss-signin .term-y   { color: #febc2e; }
.boss-signin .term-m   { color: rgba(255,253,249,0.42); }
.boss-signin .term-dim { color: rgba(255,253,249,0.3); }
.boss-signin .term-prompt { margin-top: 4px; }
.boss-signin .term-cursor {
  display: inline-block;
  width: 7px; height: 13px;
  background: rgba(255,253,249,0.4);
  vertical-align: middle;
  animation: boss-cursor-blink 1.2s step-end infinite;
}
@keyframes boss-cursor-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .boss-signin .term-cursor { animation: none; }
}

/* Quick tile bar chart */
.boss-signin .quick-bars {
  display: flex; align-items: flex-end; gap: 3px;
  height: 28px; margin-top: 10px;
}
.boss-signin .quick-bars span {
  flex: 1; border-radius: 1px 1px 0 0;
  background: rgba(78, 73, 112, 0.25);
}
.boss-signin .quick-bars span:last-child {
  background: rgba(78, 73, 112, 0.5);
}
`;
