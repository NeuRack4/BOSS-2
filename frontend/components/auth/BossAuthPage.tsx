"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BossAuthLayout } from "./BossAuthLayout";

// ── OAuth icons ──────────────────────────────────────────────
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.37-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}
function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M16.365 1.43c0 1.14-.49 2.18-1.21 2.95-.78.83-2.04 1.47-3.05 1.39-.13-1.07.42-2.18 1.13-2.92.79-.83 2.16-1.46 3.13-1.42zM20.5 17.4c-.55 1.27-.81 1.83-1.52 2.95-.99 1.56-2.39 3.51-4.13 3.52-1.55.02-1.95-1.01-4.05-1-2.1.01-2.55 1.02-4.1 1-1.74-.01-3.06-1.77-4.05-3.33-2.78-4.36-3.07-9.47-1.36-12.18 1.22-1.93 3.14-3.06 4.95-3.06 1.84 0 2.99 1.01 4.51 1.01 1.47 0 2.36-1.01 4.49-1.01 1.61 0 3.32.88 4.54 2.4-3.99 2.18-3.34 7.88.72 8.7z"/>
    </svg>
  );
}
function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.73-1.53-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18.92-.26 1.91-.39 2.89-.39.98 0 1.97.13 2.89.39 2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.13v3.16c0 .31.21.66.8.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/>
    </svg>
  );
}

const OAUTH = [
  { label: "Google", Icon: GoogleIcon },
  { label: "Apple",  Icon: AppleIcon  },
  { label: "GitHub", Icon: GithubIcon },
];

// ── Password strength ────────────────────────────────────────
const STRENGTH_LABELS = ["AWAITING INPUT", "TOO SHORT", "WEAK", "STRONG", "EXCELLENT"] as const;
const scorePassword = (pw: string): number => {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 10) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
};

function StrengthMeter({ pw }: { pw: string }) {
  const score = scorePassword(pw);
  const label = pw ? STRENGTH_LABELS[score] : STRENGTH_LABELS[0];
  const barClasses = ["s1", "s2", "s3", "s4"];
  return (
    <div className="ba-strength">
      <span style={{ minWidth: 72 }}>STRENGTH</span>
      <div className="ba-strength-bars">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={i <= score ? barClasses[score - 1] ?? "" : ""} />
        ))}
      </div>
      <span style={{ color: score >= 3 ? "#2F8B4F" : score >= 1 ? "#B8541C" : "#8A847A" }}>
        {label}
      </span>
    </div>
  );
}

// ── OAuthRow ─────────────────────────────────────────────────
function OAuthRow() {
  return (
    <div className="ba-oauth">
      {OAUTH.map(({ label, Icon }) => (
        <button
          key={label}
          type="button"
          className="ba-oauth-btn"
          disabled
          title="Coming soon"
          aria-label={`Continue with ${label} (coming soon)`}
        >
          <Icon /> {label}
        </button>
      ))}
    </div>
  );
}

// ── Sign in form ─────────────────────────────────────────────
function SignInForm({ onSuccess }: { onSuccess: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError("");
    if (!email.trim() || !password) { setError("Enter your email and password to continue."); return; }

    setLoading(true);
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) { setError("Email or password is incorrect."); setLoading(false); return; }

    const uid = data.user?.id;
    if (uid) {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/session/touch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: uid }),
        });
        const json = await res.json();
        const briefing = json?.data?.briefing;
        if (briefing?.should_fire && briefing?.message) {
          sessionStorage.setItem("boss2:pending-briefing", briefing.message);
        }
      } catch { /* briefing failure must not block sign-in */ }
    }
    router.push("/dashboard");
    router.refresh();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void submit(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, password, remember]);

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column" }}>
      <OAuthRow />
      <div className="ba-divider">or use email</div>

      <div className="ba-field">
        <label className="ba-label" htmlFor="si-email">Work email</label>
        <input id="si-email" className="ba-input" type="email" placeholder="you@company.com"
          value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </div>

      <div className="ba-field">
        <div className="ba-label-row">
          <label className="ba-label" htmlFor="si-pw">Password</label>
          <a className="ba-forgot" href="#">Forgot?</a>
        </div>
        <div className="ba-pw-wrap">
          <input id="si-pw" className="ba-input" type={showPw ? "text" : "password"}
            placeholder="Your password" value={password}
            onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          <button type="button" className="ba-pw-toggle" onClick={() => setShowPw((v) => !v)}>
            {showPw ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      <label className="ba-check" style={{ position: "relative" }}>
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span className="ba-check-box" />
        <span>Keep me signed in on this device</span>
      </label>

      {error && <p className="ba-error">{error}</p>}

      <button type="submit" className="ba-btn" disabled={loading} aria-busy={loading}>
        <span>{loading ? "Signing in…" : "Sign in"}</span>
        <span className="ba-btn-kbd">⌘ + ↵</span>
      </button>
    </form>
  );
}

// ── Create account form ───────────────────────────────────────
function CreateForm() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [terms, setTerms] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(""); setMessage("");
    if (!email.trim() || !password) { setError("Enter an email and password to continue."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (!terms) { setError("Please accept the Terms and Privacy Policy."); return; }

    setLoading(true);
    const { error: signUpError } = await supabase.auth.signUp({ email: email.trim(), password });
    if (signUpError) { setError(signUpError.message); setLoading(false); return; }
    setMessage("Workspace request received. Check your inbox for a verification link, then sign in.");
    setLoading(false);
    setTimeout(() => router.push("/login"), 1600);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void submit(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, password, confirm, terms]);

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column" }}>
      <OAuthRow />
      <div className="ba-divider">or continue with email</div>

      <div className="ba-field">
        <label className="ba-label" htmlFor="ca-email">Work email</label>
        <input id="ca-email" className="ba-input" type="email" placeholder="you@company.com"
          value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </div>

      <div className="ba-field" style={{ marginBottom: 8 }}>
        <label className="ba-label" htmlFor="ca-pw">Password</label>
        <div className="ba-pw-wrap">
          <input id="ca-pw" className="ba-input" type={showPw ? "text" : "password"}
            placeholder="Minimum 10 characters" value={password}
            onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <button type="button" className="ba-pw-toggle" onClick={() => setShowPw((v) => !v)}>
            {showPw ? "Hide" : "Show"}
          </button>
        </div>
        <StrengthMeter pw={password} />
      </div>

      <div className="ba-field" style={{ marginTop: 18 }}>
        <label className="ba-label" htmlFor="ca-pw2">Confirm password</label>
        <div className="ba-pw-wrap">
          <input id="ca-pw2" className="ba-input" type={showConfirm ? "text" : "password"}
            placeholder="Re-enter your password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          <button type="button" className="ba-pw-toggle" onClick={() => setShowConfirm((v) => !v)}>
            {showConfirm ? "Hide" : "Show"}
          </button>
        </div>
        {confirm && password !== confirm && <p className="ba-field-mismatch">Passwords do not match</p>}
      </div>

      <label className="ba-check" style={{ position: "relative" }}>
        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
        <span className="ba-check-box" />
        <span>
          I agree to the <a href="#">Terms</a> and <a href="#">Privacy Policy</a>,
          and consent to receive product updates from BOSS.
        </span>
      </label>

      {error && <p className="ba-error">{error}</p>}
      {message && <p className="ba-message">{message}</p>}

      <button type="submit" className="ba-btn" disabled={loading} aria-busy={loading}>
        <span>{loading ? "Creating workspace…" : "Create my workspace"}</span>
        <span className="ba-btn-kbd">⌘ + ↵</span>
      </button>
    </form>
  );
}

// ── Main export ───────────────────────────────────────────────
export function BossAuthPage({ initialMode }: { initialMode: "signin" | "create" }) {
  const [mode, setMode] = useState<"signin" | "create">(initialMode);

  const formTitle = mode === "signin" ? "Sign in to BOSS" : "Create your workspace";
  const formLede  = mode === "signin"
    ? "Use your work email or a connected provider."
    : "Free during private beta — no credit card, no commitments.";

  return (
    <BossAuthLayout mode={mode} onModeChange={setMode} formTitle={formTitle} formLede={formLede}>
      {mode === "signin" ? <SignInForm onSuccess={() => {}} /> : <CreateForm />}
    </BossAuthLayout>
  );
}
