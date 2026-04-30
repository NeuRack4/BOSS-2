"use client";

import { DM_Sans, DM_Mono, Instrument_Serif } from "next/font/google";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--ba-sans",
});
const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--ba-mono",
});
const instrSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--ba-serif",
});

const ACCENT = "#B8541C";

interface Props {
  mode: "signin" | "create";
  onModeChange: (m: "signin" | "create") => void;
  formTitle: string;
  formLede: string;
  children: React.ReactNode;
}

function MetricCard() {
  const bars = [0.3, 0.45, 0.4, 0.6, 0.5, 0.75, 0.65, 0.9];
  return (
    <div className="ba-metric">
      <div className="ba-metric-body">
        <div className="ba-metric-label">This week</div>
        <div className="ba-metric-row">
          <span className="ba-metric-num">+128</span>
          <span className="ba-metric-unit">tasks handled</span>
        </div>
      </div>
      <div className="ba-metric-bars" aria-hidden="true">
        {bars.map((h, i) => (
          <span
            key={i}
            style={{
              height: `${h * 100}%`,
              background:
                i === bars.length - 1 ? ACCENT : "rgba(242,238,229,.35)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

export const BossAuthLayout = ({
  mode,
  onModeChange,
  formTitle,
  formLede,
  children,
}: Props) => {

  return (
    <div
      className={`ba-root ${dmSans.variable} ${dmMono.variable} ${instrSerif.variable}`}
    >
      <style>{CSS}</style>

      {/* ── LEFT — dark stage ─────────────────────────────── */}
      <aside className="ba-stage">
        <div className="ba-mesh" aria-hidden="true" />

        {/* top row */}
        <div className="ba-stage-top">
          <div className="ba-logo">
            <span className="ba-mark">B</span>
            <span>BOSS</span>
          </div>
          <div className="ba-pill">
            <span className="ba-pill-dot" />
            {mode === "signin" ? "Returning member" : "Private Beta"}
          </div>
        </div>

        {/* center */}
        <div className="ba-stage-center">
          <div className="ba-stage-content">
            <span className="ba-eyebrow">
              <span className="ba-eye-dot" />
              {mode === "signin" ? "01 · Sign in" : "01 · Get started"}
            </span>

            <h1 className="ba-headline">
              {mode === "signin" ? (
                <>
                  Welcome <em>back.</em>
                </>
              ) : (
                <>
                  The operating <em>layer</em>
                  <br />
                  for your shop floor.
                </>
              )}
            </h1>

            <p className="ba-stage-lede">
              {mode === "signin"
                ? "Your agents, schedules and chats are right where you left them. Sign in to keep moving — no setup, no friction."
                : "BOSS connects hiring, marketing, sales and paperwork into one agentic workspace — built for owners, not enterprises."}
            </p>

            {mode === "signin" && <MetricCard />}
          </div>
        </div>

        {/* foot */}
        <div className="ba-stage-foot">
          <span>2,847 small businesses</span>
          <span>SOC 2 · GDPR · SSO/SAML</span>
        </div>
      </aside>

      {/* ── RIGHT — form panel ──────────────────────────────── */}
      <section className="ba-panel">
        {/* top row */}
        <div className="ba-panel-top">
          <button type="button" className="ba-locale">
            <span className="ba-locale-dot" />
            EN · USD
          </button>
        </div>

        {/* form column */}
        <div className="ba-form-col">
          {/* tab toggle */}
          <div className="ba-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={mode === "signin"}
              onClick={() => onModeChange("signin")}
            >
              Sign in
            </button>
            <button
              role="tab"
              aria-selected={mode === "create"}
              onClick={() => onModeChange("create")}
            >
              Create account
            </button>
          </div>

          <h2 className="ba-form-title">{formTitle}</h2>
          <p className="ba-form-lede">{formLede}</p>

          {children}
        </div>

        {/* panel footer */}
        <div className="ba-panel-foot">
          <span>© 2026 BOSS Labs</span>
          <a href="#" className="ba-foot-link">
            Status ↗
          </a>
        </div>
      </section>
    </div>
  );
};

const CSS = `
/* ── Root layout ─────────────────────────────────────────── */
.ba-root {
  display: grid;
  grid-template-columns: 50% 50%;
  height: 100vh;
  overflow: hidden;
  font-family: var(--ba-sans), ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 17px;
  color: #14110D;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  letter-spacing: -0.005em;
}
.ba-root, .ba-root * { box-sizing: border-box; }
.ba-root button { font: inherit; color: inherit; cursor: pointer; }
.ba-root input  { font: inherit; color: inherit; }
.ba-root a      { color: inherit; }

/* ── LEFT STAGE ────────────────────────────────────────────── */
.ba-stage {
  background: #14110D;
  color: #F8F4EB;
  padding: 36px 56px 20px;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  height: 100%;
  width: 100%;
}

.ba-mesh {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(50% 50% at 20% 80%, ${ACCENT}88 0%, transparent 60%),
    radial-gradient(40% 50% at 90% 30%, rgba(255,255,255,.08) 0%, transparent 60%),
    radial-gradient(60% 70% at 50% 110%, ${ACCENT}55 0%, transparent 70%);
  filter: saturate(1.05);
}

/* stage top row */
.ba-stage-top {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.ba-logo {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  font-size: 15px;
  letter-spacing: 0.02em;
  color: #F8F4EB;
}
.ba-mark {
  width: 28px; height: 28px;
  border-radius: 7px;
  background: #fff;
  color: #14110D;
  display: grid;
  place-items: center;
  font-family: var(--ba-mono), ui-monospace, monospace;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0;
  flex-shrink: 0;
}

.ba-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.16);
  background: rgba(255,255,255,.06);
  font-family: var(--ba-mono), ui-monospace, monospace;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: rgba(242,238,229,.85);
}
.ba-pill-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: ${ACCENT};
  flex-shrink: 0;
}

/* stage center */
.ba-stage-center {
  flex: 1;
  display: flex;
  align-items: center;
  position: relative;
  z-index: 1;
  padding: 40px 0;
}
.ba-stage-content { max-width: 560px; }

.ba-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--ba-mono), ui-monospace, monospace;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(242,238,229,.7);
  margin-bottom: 24px;
}
.ba-eye-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: ${ACCENT};
  flex-shrink: 0;
}

.ba-headline {
  margin: 0;
  font-size: calc(17px * 5);
  line-height: 0.98;
  letter-spacing: -0.035em;
  font-weight: 600;
  color: #F8F4EB;
  overflow-wrap: break-word;
  word-break: break-word;
}
.ba-headline em {
  font-family: var(--ba-serif), 'Times New Roman', serif;
  font-style: italic;
  font-weight: 400;
  color: ${ACCENT};
}

.ba-stage-lede {
  margin-top: 28px;
  max-width: 460px;
  font-size: 18px;
  line-height: 1.55;
  color: rgba(242,238,229,.7);
}

/* metric card */
.ba-metric {
  margin-top: 36px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.04);
  padding: 18px 20px;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 16px;
  align-items: end;
  max-width: 360px;
  backdrop-filter: blur(8px);
}
.ba-metric-label {
  font-family: var(--ba-mono), ui-monospace, monospace;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(242,238,229,.55);
  margin-bottom: 8px;
}
.ba-metric-row { display: flex; align-items: baseline; gap: 8px; }
.ba-metric-num {
  font-size: 36px;
  letter-spacing: -0.02em;
  font-weight: 600;
  color: #F8F4EB;
}
.ba-metric-unit {
  font-family: var(--ba-mono), ui-monospace, monospace;
  font-size: 14px;
  color: rgba(242,238,229,.7);
}
.ba-metric-bars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 36px;
}
.ba-metric-bars span {
  width: 6px;
  border-radius: 1px;
}

/* stage foot */
.ba-stage-foot {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  font-family: var(--ba-mono), ui-monospace, monospace;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(242,238,229,.5);
  flex-shrink: 0;
}

/* ── RIGHT PANEL ────────────────────────────────────────────── */
.ba-panel {
  background: #FAF7F1;
  padding: 24px 56px 20px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
  width: 100%;
}

.ba-panel-top {
  display: flex;
  justify-content: flex-end;
  flex-shrink: 0;
}
.ba-locale {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid #D5CDBE;
  border-radius: 8px;
  background: #fff;
  font-family: var(--ba-mono), ui-monospace, monospace;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: #5C5750;
  transition: border-color .15s;
}
.ba-locale:hover { border-color: #BFB6A4; }
.ba-locale-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #6BA864;
  flex-shrink: 0;
}

/* form column — tabs always at fixed distance from top */
.ba-form-col {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  max-width: 460px;
  width: 100%;
  margin: 0 auto;
  padding-top: 20px;
  padding-bottom: 16px;
}

/* tab toggle */
.ba-tabs {
  display: inline-flex;
  align-self: flex-start;
  padding: 4px;
  gap: 2px;
  border-radius: 11px;
  background: #F2EEE5;
  border: 1px solid #E5DFD3;
  margin-bottom: 20px;
}
.ba-tabs button {
  appearance: none;
  border: 0;
  background: transparent;
  height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  font-family: var(--ba-mono), ui-monospace, monospace;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #5C5750;
  transition: background .15s, color .15s;
  white-space: nowrap;
}
.ba-tabs button[aria-selected="true"] {
  background: #fff;
  color: #14110D;
  box-shadow: 0 1px 2px rgba(20,17,13,.08);
}

.ba-form-title {
  margin: 0;
  font-size: 33px;
  line-height: 1.1;
  letter-spacing: -0.02em;
  font-weight: 600;
  color: #14110D;
}
.ba-form-lede {
  margin: 8px 0 16px;
  font-size: 16px;
  line-height: 1.5;
  color: #2A2620;
}

/* ── Shared form primitives ──────────────────────────────── */
.ba-oauth {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.ba-oauth-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 44px;
  padding: 0 12px;
  border: 1px solid #D5CDBE;
  background: #fff;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 500;
  color: #14110D;
  transition: background .12s, border-color .12s, transform .1s;
  opacity: 0.55;
  cursor: not-allowed;
}
.ba-oauth-btn:not(:disabled):hover { background: #FAF7F1; border-color: #BFB6A4; }
.ba-oauth-btn:not(:disabled):active { transform: translateY(1px); }
.ba-oauth-btn svg { width: 18px; height: 18px; flex: none; }

.ba-divider {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 14px 0;
  font-family: var(--ba-mono), ui-monospace, monospace;
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #5C5750;
  white-space: nowrap;
}
.ba-divider::before, .ba-divider::after {
  content: '';
  flex: 1 1 0;
  height: 1px;
  background: #D5CDBE;
}

.ba-field { margin-bottom: 12px; }
.ba-label {
  display: block;
  font-family: var(--ba-mono), ui-monospace, monospace;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #5C5750;
  margin-bottom: 8px;
}
.ba-label-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
}
.ba-label-row .ba-label { margin-bottom: 0; }

.ba-input {
  width: 100%;
  height: 46px;
  padding: 0 16px;
  border-radius: 10px;
  border: 1px solid #D5CDBE;
  background: #FBF9F4;
  color: #14110D;
  font-size: 17px;
  font-family: var(--ba-sans), ui-sans-serif, system-ui, sans-serif;
  outline: none;
  transition: border-color .15s, box-shadow .15s, background .15s;
}
.ba-input::placeholder { color: #8A847A; }
.ba-input:hover { border-color: #BFB6A4; }
.ba-input:focus {
  border-color: #14110D;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(20,17,13,.08);
}

.ba-pw-wrap { position: relative; }
.ba-pw-wrap .ba-input { padding-right: 76px; }
.ba-pw-toggle {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  height: 36px;
  padding: 0 10px;
  border: 0;
  background: transparent;
  font-family: var(--ba-mono), ui-monospace, monospace;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #2A2620;
  border-radius: 7px;
  transition: background .12s;
}
.ba-pw-toggle:hover { background: #F2EEE5; }

.ba-forgot {
  font-family: var(--ba-mono), ui-monospace, monospace;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #14110D;
  text-decoration: none;
  border-bottom: 1px solid #14110D;
  padding-bottom: 1px;
  transition: color .15s, border-color .15s;
}
.ba-forgot:hover { color: ${ACCENT}; border-color: ${ACCENT}; }

/* strength meter */
.ba-strength {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  font-family: var(--ba-mono), ui-monospace, monospace;
  font-size: 13px;
  letter-spacing: 0.04em;
  color: #5C5750;
}
.ba-strength-bars { display: flex; gap: 3px; flex: 1; }
.ba-strength-bars span {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: #D5CDBE;
  transition: background .2s;
}
.ba-strength-bars span.s1 { background: #C8542C; }
.ba-strength-bars span.s2 { background: #D89A3E; }
.ba-strength-bars span.s3 { background: #6BA864; }
.ba-strength-bars span.s4 { background: #2F8B4F; }

/* checkbox */
.ba-check {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  font-size: 15px;
  color: #2A2620;
  line-height: 1.45;
  cursor: pointer;
  user-select: none;
  margin-bottom: 14px;
}
.ba-check > span:last-child { text-wrap: pretty; }
.ba-check input { position: absolute; opacity: 0; pointer-events: none; }
.ba-check-box {
  flex: none;
  width: 20px; height: 20px;
  border-radius: 5px;
  border: 1.5px solid #D5CDBE;
  background: #fff;
  display: grid;
  place-items: center;
  margin-top: 1px;
  transition: background .12s, border-color .12s;
}
.ba-check input:checked + .ba-check-box {
  background: #14110D;
  border-color: #14110D;
}
.ba-check input:checked + .ba-check-box::after {
  content: '';
  width: 10px; height: 6px;
  border-left: 2px solid #fff;
  border-bottom: 2px solid #fff;
  transform: rotate(-45deg) translate(1px, -1px);
}
.ba-check a {
  color: #14110D;
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* primary button */
.ba-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 50px;
  padding: 0 20px;
  border: 0;
  border-radius: 12px;
  background: #14110D;
  color: #fff;
  font-family: var(--ba-sans), ui-sans-serif, system-ui, sans-serif;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.005em;
  white-space: nowrap;
  transition: transform .12s, box-shadow .12s, background .12s;
  box-shadow: 0 1px 0 rgba(255,255,255,.06) inset, 0 8px 20px -8px rgba(20,17,13,.4);
  cursor: pointer;
}
.ba-btn:hover { background: #000; transform: translateY(-1px); }
.ba-btn:active { transform: translateY(0); }
.ba-btn:disabled { opacity: 0.6; cursor: progress; transform: none; }
.ba-btn-kbd {
  font-family: var(--ba-mono), ui-monospace, monospace;
  font-size: 13px;
  color: rgba(255,255,255,.55);
  font-weight: 500;
  white-space: nowrap;
}

/* error / message */
.ba-error {
  margin: 0 0 12px;
  font-family: var(--ba-mono), ui-monospace, monospace;
  font-size: 13px;
  color: #b04a3f;
  letter-spacing: 0.02em;
}
.ba-message {
  margin: 0 0 12px;
  font-family: var(--ba-mono), ui-monospace, monospace;
  font-size: 13px;
  color: #3e6659;
  letter-spacing: 0.02em;
}
.ba-field-mismatch {
  margin: 5px 0 0;
  font-family: var(--ba-mono), ui-monospace, monospace;
  font-size: 12px;
  color: #b04a3f;
  letter-spacing: 0.02em;
}

/* panel footer */
.ba-panel-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: var(--ba-mono), ui-monospace, monospace;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #8A847A;
  flex-shrink: 0;
  margin-top: 16px;
}
.ba-foot-link {
  color: #8A847A;
  text-decoration: none;
  transition: color .15s;
}
.ba-foot-link:hover { color: #14110D; }

/* ── Responsive ─────────────────────────────────────────────── */
@media (max-width: 960px) {
  .ba-root { grid-template-columns: 1fr; }
  .ba-stage { min-height: auto; padding: 36px 40px; }
  .ba-headline { font-size: calc(17px * 3.5); }
  .ba-stage-center { padding: 32px 0; }
  .ba-metric { max-width: 100%; }
}
@media (max-width: 600px) {
  .ba-stage { padding: 28px 24px; }
  .ba-panel { padding: 28px 24px; }
  .ba-headline { font-size: calc(17px * 2.8); }
  .ba-form-col { padding: 28px 0; }
}
`;
