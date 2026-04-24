"use client";

import React, { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

type PlatformStatus = {
  connected: boolean;
  updated_at?: string;
  [key: string]: unknown;
};
type Tab = "youtube" | "instagram" | "naver";
type Props = { open: boolean; onClose: () => void };

/* ── 플랫폼 탭 색상 ───────────────────────────────────────────────────────── */
const TAB_COLOR: Record<Tab, { underline: string; dot: string; icon: string }> =
  {
    youtube: {
      underline: "border-[#cc0000]",
      dot: "bg-[#cc0000]",
      icon: "#cc0000",
    },
    instagram: {
      underline: "border-[#a02b6e]",
      dot: "bg-[#a02b6e]",
      icon: "#a02b6e",
    },
    naver: {
      underline: "border-[#00a64a]",
      dot: "bg-[#00a64a]",
      icon: "#00a64a",
    },
  };

/* ── 플랫폼 콘텐츠 색상 (박스·스텝) ─────────────────────────────────────── */
const CONTENT: Record<
  Tab,
  {
    border: string;
    headerBg: string;
    headerBorder: string;
    stepBg: string;
    stepText: string;
    codeBg: string;
    codeBorder: string;
    formBorder: string;
  }
> = {
  youtube: {
    border: "border-red-100",
    headerBg: "bg-red-50",
    headerBorder: "border-red-100",
    stepBg: "bg-red-100",
    stepText: "text-red-700",
    codeBg: "bg-red-50",
    codeBorder: "border-red-100",
    formBorder: "border-red-100",
  },
  instagram: {
    border: "border-purple-100",
    headerBg: "bg-purple-50",
    headerBorder: "border-purple-100",
    stepBg: "bg-purple-100",
    stepText: "text-purple-700",
    codeBg: "bg-purple-50",
    codeBorder: "border-purple-100",
    formBorder: "border-purple-100",
  },
  naver: {
    border: "border-green-100",
    headerBg: "bg-green-50",
    headerBorder: "border-green-100",
    stepBg: "bg-green-100",
    stepText: "text-green-700",
    codeBg: "bg-green-50",
    codeBorder: "border-green-100",
    formBorder: "border-green-100",
  },
};

/* ── 공통 서브컴포넌트 ─────────────────────────────────────────────────────── */
const Step = ({
  n,
  tab,
  children,
}: {
  n: number;
  tab: Tab;
  children: React.ReactNode;
}) => (
  <div className="flex gap-3">
    <span
      className={`${CONTENT[tab].stepBg} ${CONTENT[tab].stepText} text-[11px] font-semibold w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5`}
    >
      {n}
    </span>
    <div className="text-[13px] text-[#374151] leading-relaxed flex-1">
      {children}
    </div>
  </div>
);

const Code = ({ tab, children }: { tab: Tab; children: string }) => (
  <pre
    className={`mt-1.5 ${CONTENT[tab].codeBg} border ${CONTENT[tab].codeBorder} text-[#1f2937] rounded-md px-3 py-2.5 text-[12px] font-mono leading-relaxed overflow-x-auto select-all`}
  >
    {children}
  </pre>
);

const Hint = ({ children }: { children: React.ReactNode }) => (
  <span className="block mt-0.5 text-[12px] text-[#9ca3af]">{children}</span>
);

const GuideBox = ({
  tab,
  title,
  children,
}: {
  tab: Tab;
  title: string;
  children: React.ReactNode;
}) => (
  <div
    className={`shrink-0 rounded-xl border ${CONTENT[tab].border} overflow-hidden`}
  >
    <div
      className={`${CONTENT[tab].headerBg} border-b ${CONTENT[tab].headerBorder} px-4 py-2.5`}
    >
      <p className="text-[12px] font-semibold text-[#374151] tracking-wide">
        {title}
      </p>
    </div>
    <div className="bg-white px-4 py-4 flex flex-col gap-3.5">{children}</div>
  </div>
);

const FormCard = ({
  tab,
  children,
}: {
  tab: Tab;
  children: React.ReactNode;
}) => (
  <div
    className={`shrink-0 rounded-xl border ${CONTENT[tab].formBorder} bg-white px-4 py-4 flex flex-col gap-4 shadow-sm`}
  >
    {children}
  </div>
);

const Field = ({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-[12px] font-medium text-[#374151]">
      {label}
      {required && <span className="text-[#ef4444] ml-0.5">*</span>}
      {hint && <span className="ml-1 font-normal text-[#9ca3af]">{hint}</span>}
    </label>
    {children}
  </div>
);

const inputCls = (_tab?: Tab) =>
  "w-full rounded-md border border-[#d1d5db] bg-white px-3 py-2 text-[13px] text-[#111827] placeholder:text-[#9ca3af] outline-none transition focus:ring-2 focus:ring-[#6b7280]/20 focus:border-[#9ca3af]";

const StatusBanner = ({
  connected,
  children,
}: {
  connected: boolean;
  children: React.ReactNode;
}) => (
  <div
    className={`flex items-center gap-2 rounded-md px-3 py-2.5 text-[13px] border ${
      connected
        ? "bg-[#f0fdf4] border-[#bbf7d0] text-[#166534]"
        : "bg-[#f9fafb] border-[#e5e7eb] text-[#6b7280]"
    }`}
  >
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? "bg-[#22c55e]" : "bg-[#d1d5db]"}`}
    />
    {children}
  </div>
);

/* ── 메인 컴포넌트 ─────────────────────────────────────────────────────────── */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const IntegrationsModal = ({ open, onClose }: Props) => {
  const supabase = createClient();
  const [accountId, setAccountId] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("youtube");

  const [naverStatus, setNaverStatus] = useState<PlatformStatus>({
    connected: false,
  });
  const [igStatus, setIgStatus] = useState<PlatformStatus>({
    connected: false,
  });
  const [ytStatus, setYtStatus] = useState<PlatformStatus>({
    connected: false,
  });

  const [blogId, setBlogId] = useState("");
  const [cookieFile, setCookieFile] = useState<File | null>(null);
  const cookieFileRef = useRef<HTMLInputElement>(null);
  const [naverSaving, setNaverSaving] = useState(false);
  const [naverMsg, setNaverMsg] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  const [metaToken, setMetaToken] = useState("");
  const [metaIgToken, setMetaIgToken] = useState("");
  const [igUserId, setIgUserId] = useState("");
  const [igSaving, setIgSaving] = useState(false);
  const [igMsg, setIgMsg] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setAccountId(data.user.id);
    });
  }, []);

  useEffect(() => {
    if (open && accountId) fetchAll();
  }, [open, accountId]);

  const fetchAll = async () => {
    const safeJson = async (url: string) => {
      try {
        const r = await fetch(url);
        if (!r.ok) return { connected: false };
        return await r.json();
      } catch {
        return { connected: false };
      }
    };
    const [naver, ig, yt] = await Promise.all([
      safeJson(`${API}/api/integrations/naver_blog?account_id=${accountId}`),
      safeJson(`${API}/api/integrations/instagram?account_id=${accountId}`),
      safeJson(`${API}/api/integrations/youtube?account_id=${accountId}`),
    ]);
    setNaverStatus(naver);
    if (naver.blog_id) setBlogId(naver.blog_id);
    setIgStatus(ig);
    setYtStatus(yt);
  };

  const saveNaver = async () => {
    setNaverMsg(null);
    if (!blogId.trim())
      return setNaverMsg({ type: "err", text: "블로그 ID를 입력해 주세요." });
    if (!cookieFile)
      return setNaverMsg({
        type: "err",
        text: "naver_cookies.json 파일을 선택해 주세요.",
      });
    setNaverSaving(true);
    try {
      const form = new FormData();
      form.append("account_id", accountId);
      form.append("blog_id", blogId.trim());
      form.append("cookie_file", cookieFile);
      const res = await fetch(`${API}/api/integrations/naver_blog`, {
        method: "PUT",
        body: form,
      });
      if (!res.ok) {
        const d = await res.json();
        return setNaverMsg({ type: "err", text: d.detail || "저장 실패" });
      }
      setNaverMsg({ type: "ok", text: "저장되었습니다." });
      setCookieFile(null);
      if (cookieFileRef.current) cookieFileRef.current.value = "";
      fetchAll();
    } catch {
      setNaverMsg({ type: "err", text: "네트워크 오류" });
    } finally {
      setNaverSaving(false);
    }
  };

  const disconnectNaver = async () => {
    if (!confirm("네이버 블로그 연결을 해제하시겠습니까?")) return;
    await fetch(`${API}/api/integrations/naver_blog?account_id=${accountId}`, {
      method: "DELETE",
    });
    setBlogId("");
    setCookieFile(null);
    setNaverMsg(null);
    fetchAll();
  };

  const saveInstagram = async () => {
    setIgMsg(null);
    if (!metaToken.trim() || !igUserId.trim())
      return setIgMsg({
        type: "err",
        text: "Meta Access Token과 Instagram User ID는 필수입니다.",
      });
    setIgSaving(true);
    try {
      const res = await fetch(`${API}/api/integrations/instagram`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          meta_access_token: metaToken.trim(),
          meta_ig_access_token: metaIgToken.trim(),
          instagram_user_id: igUserId.trim(),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        return setIgMsg({ type: "err", text: d.detail || "저장 실패" });
      }
      setIgMsg({ type: "ok", text: "저장되었습니다." });
      fetchAll();
    } catch {
      setIgMsg({ type: "err", text: "네트워크 오류" });
    } finally {
      setIgSaving(false);
    }
  };

  const disconnectInstagram = async () => {
    if (!confirm("Instagram 연결을 해제하시겠습니까?")) return;
    await fetch(`${API}/api/integrations/instagram?account_id=${accountId}`, {
      method: "DELETE",
    });
    setMetaToken("");
    setMetaIgToken("");
    setIgUserId("");
    setIgMsg(null);
    fetchAll();
  };

  const connectYouTube = async () => {
    const res = await fetch(
      `${API}/api/marketing/youtube/oauth/start?account_id=${accountId}`,
    );
    const data = await res.json();
    if (!data.url) return;
    const popup = window.open(
      data.url,
      "youtube_oauth",
      "width=600,height=700,scrollbars=yes",
    );
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== "youtube_connected") return;
      window.removeEventListener("message", onMessage);
      popup?.close();
      if (e.data.success) fetchAll();
    };
    window.addEventListener("message", onMessage);
    const timer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(timer);
        window.removeEventListener("message", onMessage);
        fetchAll();
      }
    }, 1000);
  };

  const disconnectYouTube = async () => {
    if (!confirm("YouTube 연결을 해제하시겠습니까?")) return;
    await fetch(`${API}/api/integrations/youtube?account_id=${accountId}`, {
      method: "DELETE",
    });
    fetchAll();
  };

  const ICONS: Record<Tab, React.ReactNode> = {
    youtube: (
      <svg
        viewBox="0 0 24 24"
        className="w-3.5 h-3.5 shrink-0"
        fill={TAB_COLOR.youtube.icon}
      >
        <path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.54 3.5 12 3.5 12 3.5s-7.54 0-9.38.55A3.02 3.02 0 0 0 .5 6.19C0 8.04 0 12 0 12s0 3.96.5 5.81a3.02 3.02 0 0 0 2.12 2.14C4.46 20.5 12 20.5 12 20.5s7.54 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14C24 15.96 24 12 24 12s0-3.96-.5-5.81zM9.75 15.5v-7l6.5 3.5-6.5 3.5z" />
      </svg>
    ),
    instagram: (
      <svg
        viewBox="0 0 24 24"
        className="w-3.5 h-3.5 shrink-0"
        fill={TAB_COLOR.instagram.icon}
      >
        <path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12c0 3.259.014 3.668.072 4.948.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.689.072-4.948 0-3.259-.015-3.667-.072-4.947-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z" />
      </svg>
    ),
    naver: (
      <svg
        viewBox="0 0 24 24"
        className="w-3.5 h-3.5 shrink-0"
        fill={TAB_COLOR.naver.icon}
      >
        <path d="M16.273 12.845 7.376 0H0v24h7.727V11.155L16.624 24H24V0h-7.727z" />
      </svg>
    ),
  };

  const TABS = [
    { id: "youtube" as Tab, label: "YouTube", status: ytStatus },
    { id: "instagram" as Tab, label: "Instagram", status: igStatus },
    { id: "naver" as Tab, label: "네이버 블로그", status: naverStatus },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="플랫폼 연결 설정"
      widthClass="w-[580px]"
    >
      {/* ── 탭 헤더 ──────────────────────────────────────────────────────── */}
      <div className="flex border-b border-[#e5e7eb] mb-5 -mx-4 px-4">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] border-b-2 -mb-px transition-all ${
                isActive
                  ? `${TAB_COLOR[tab.id].underline} text-[#111827] font-medium`
                  : "border-transparent text-[#9ca3af] hover:text-[#6b7280] font-normal"
              }`}
            >
              {ICONS[tab.id]}
              {tab.label}
              {tab.status.connected && (
                <span
                  className={`w-1.5 h-1.5 rounded-full ${TAB_COLOR[tab.id].dot}`}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* ── YouTube ──────────────────────────────────────────────────────── */}
      {activeTab === "youtube" && (
        <div className="flex flex-col gap-4 overflow-y-auto flex-1 min-h-0 pr-0.5">
          {ytStatus.connected ? (
            <div className="rounded-xl border border-red-100 overflow-hidden">
              <div className="bg-red-50 border-b border-red-100 px-4 py-3 flex items-center gap-2.5">
                <svg
                  viewBox="0 0 24 24"
                  className="w-4 h-4 shrink-0"
                  fill="#cc0000"
                >
                  <path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.54 3.5 12 3.5 12 3.5s-7.54 0-9.38.55A3.02 3.02 0 0 0 .5 6.19C0 8.04 0 12 0 12s0 3.96.5 5.81a3.02 3.02 0 0 0 2.12 2.14C4.46 20.5 12 20.5 12 20.5s7.54 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14C24 15.96 24 12 24 12s0-3.96-.5-5.81zM9.75 15.5v-7l6.5 3.5-6.5 3.5z" />
                </svg>
                <span className="text-[13px] font-semibold text-[#111827]">
                  YouTube
                </span>
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-[11px] font-semibold text-green-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  연결됨
                </span>
              </div>
              <div className="bg-white px-4 py-4 flex flex-col gap-4">
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center gap-3 text-[13px]">
                    <span className="w-24 shrink-0 text-[#9ca3af]">
                      연결 방식
                    </span>
                    <span className="font-medium text-[#111827]">
                      Google OAuth 2.0
                    </span>
                  </div>
                  {ytStatus.expires_at && (
                    <div className="flex items-center gap-3 text-[13px]">
                      <span className="w-24 shrink-0 text-[#9ca3af]">
                        토큰 만료일
                      </span>
                      <span className="text-[#111827]">
                        {new Date(
                          ytStatus.expires_at as string,
                        ).toLocaleDateString("ko-KR")}
                      </span>
                    </div>
                  )}
                </div>
                <div className="rounded-lg bg-[#f9fafb] border border-[#f3f4f6] px-3 py-3">
                  <p className="text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wide mb-2">
                    활성화된 기능
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {[
                      "유튜브 쇼츠 자동 업로드",
                      "영상 제목·설명·태그 자동 생성",
                    ].map((f) => (
                      <div
                        key={f}
                        className="flex items-center gap-2 text-[12px] text-[#374151]"
                      >
                        <svg
                          className="w-3.5 h-3.5 text-green-500 shrink-0"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        {f}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end border-t border-[#f3f4f6] pt-3">
                  <button
                    type="button"
                    onClick={disconnectYouTube}
                    className="text-[12px] text-red-500 hover:text-red-600 font-medium transition-colors"
                  >
                    연결 해제
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <StatusBanner connected={false}>
              아직 연결되지 않았습니다. 아래 안내를 따라 연결하세요.
            </StatusBanner>
          )}

          {!ytStatus.connected && (
            <GuideBox tab="youtube" title="연결 방법 (최초 1회 설정)">
              <Step n={1} tab="youtube">
                <strong>console.cloud.google.com</strong> 접속 → Google 계정으로
                로그인
              </Step>
              <Step n={2} tab="youtube">
                상단 <strong>"프로젝트 선택"</strong> 드롭다운 클릭 → 우측 상단{" "}
                <strong>"새 프로젝트"</strong> 클릭 → 프로젝트 이름 입력 (아무
                이름) → <strong>"만들기"</strong>
              </Step>
              <Step n={3} tab="youtube">
                왼쪽 메뉴 <strong>"API 및 서비스"</strong> →{" "}
                <strong>"라이브러리"</strong> 클릭 → 검색창에{" "}
                <strong>"YouTube Data API v3"</strong> 검색 → 클릭 →{" "}
                <strong>"사용 설정"</strong> 버튼 클릭
              </Step>
              <Step n={4} tab="youtube">
                왼쪽 메뉴 <strong>"OAuth 동의 화면"</strong> 클릭 →{" "}
                <strong>"외부"</strong> 선택 → <strong>"만들기"</strong> → 앱
                이름(아무거나)·이메일 주소 입력 → 하단{" "}
                <strong>"저장 후 계속"</strong>을 끝까지 클릭 →{" "}
                <strong>"대시보드로 돌아가기"</strong>
              </Step>
              <Step n={5} tab="youtube">
                왼쪽 메뉴 <strong>"사용자 인증 정보"</strong> 클릭 → 상단{" "}
                <strong>"+ 사용자 인증 정보 만들기"</strong> →{" "}
                <strong>"OAuth 클라이언트 ID"</strong> 선택 → 애플리케이션 유형{" "}
                <strong>"웹 애플리케이션"</strong> 선택
              </Step>
              <Step n={6} tab="youtube">
                아래로 스크롤 → <strong>"승인된 리디렉션 URI"</strong> 항목에서{" "}
                <strong>"+ URI 추가"</strong> 클릭 → 아래 주소를 정확히 입력 →{" "}
                <strong>"만들기"</strong>
                <Code tab="youtube">{`http://localhost:8000/api/marketing/youtube/oauth/callback`}</Code>
              </Step>
              <Step n={7} tab="youtube">
                팝업에 표시되는 <strong>클라이언트 ID</strong>와{" "}
                <strong>클라이언트 보안 비밀</strong>을 복사 → 프로젝트의{" "}
                <code className="bg-red-50 text-red-700 rounded px-1 text-[12px]">
                  backend/.env
                </code>{" "}
                파일을 열어 아래와 같이 붙여넣기
                <Code tab="youtube">{`YOUTUBE_CLIENT_ID=복사한_클라이언트_ID\nYOUTUBE_CLIENT_SECRET=복사한_클라이언트_보안비밀`}</Code>
              </Step>
              <Step n={8} tab="youtube">
                백엔드 서버를 <strong>재시작</strong>한 뒤, 아래{" "}
                <strong>"Google 계정 연결하기"</strong> 버튼 클릭 → 팝업 창에서
                본인 Google 계정으로 로그인하면 완료
              </Step>
            </GuideBox>
          )}

          {!ytStatus.connected && (
            <Button
              onClick={connectYouTube}
              className="self-start bg-[#111827] text-white hover:bg-[#374151] text-[13px] px-4 py-2 h-auto rounded-md"
            >
              Google 계정 연결하기
            </Button>
          )}
        </div>
      )}

      {/* ── Instagram ────────────────────────────────────────────────────── */}
      {activeTab === "instagram" && (
        <div className="flex flex-col gap-4 overflow-y-auto flex-1 min-h-0 pr-0.5">
          {igStatus.connected ? (
            <div className="rounded-xl border border-purple-100 overflow-hidden">
              <div className="bg-purple-50 border-b border-purple-100 px-4 py-3 flex items-center gap-2.5">
                <svg
                  viewBox="0 0 24 24"
                  className="w-4 h-4 shrink-0"
                  fill="#a02b6e"
                >
                  <path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12c0 3.259.014 3.668.072 4.948.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.689.072-4.948 0-3.259-.015-3.667-.072-4.947-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z" />
                </svg>
                <span className="text-[13px] font-semibold text-[#111827]">
                  Instagram
                </span>
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-[11px] font-semibold text-green-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  연결됨
                </span>
              </div>
              <div className="bg-white px-4 py-4 flex flex-col gap-4">
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center gap-3 text-[13px]">
                    <span className="w-24 shrink-0 text-[#9ca3af]">
                      계정 ID
                    </span>
                    <span className="font-medium text-[#111827] font-mono">
                      {igStatus.instagram_user_id as string}
                    </span>
                  </div>
                  {igStatus.updated_at && (
                    <div className="flex items-center gap-3 text-[13px]">
                      <span className="w-24 shrink-0 text-[#9ca3af]">
                        마지막 갱신
                      </span>
                      <span className="text-[#111827]">
                        {new Date(
                          igStatus.updated_at as string,
                        ).toLocaleDateString("ko-KR")}
                      </span>
                    </div>
                  )}
                </div>
                <div className="rounded-lg bg-[#f9fafb] border border-[#f3f4f6] px-3 py-3">
                  <p className="text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wide mb-2">
                    활성화된 기능
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {[
                      "게시물 자동 업로드",
                      "릴스 자동 업로드",
                      "Instagram DM 자동 캠페인",
                    ].map((f) => (
                      <div
                        key={f}
                        className="flex items-center gap-2 text-[12px] text-[#374151]"
                      >
                        <svg
                          className="w-3.5 h-3.5 text-green-500 shrink-0"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        {f}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-700">
                  ⚠️ Meta Access Token은 약 60일 후 만료됩니다. 만료 전에 아래
                  폼에서 갱신하세요.
                </div>
              </div>
            </div>
          ) : (
            <StatusBanner connected={false}>
              아직 연결되지 않았습니다. 아래 안내를 따라 토큰을 발급하세요.
            </StatusBanner>
          )}

          {!igStatus.connected && (
            <GuideBox tab="instagram" title="토큰 발급 방법 (최초 1회 설정)">
              <Step n={1} tab="instagram">
                <strong>인스타그램 비즈니스 계정으로 전환</strong> (이미 되어
                있으면 건너뜀)
                <Hint>
                  인스타그램 앱 → 프로필 → 우측 상단 메뉴(≡) → 설정 → 계정 →
                  "전문가 계정으로 전환" → "비즈니스" 선택
                </Hint>
              </Step>
              <Step n={2} tab="instagram">
                <strong>Facebook 페이지 연결</strong> (없으면 먼저 생성)
                <Hint>
                  인스타그램 앱 → 프로필 → 설정 → 계정 → "연결된 계정" →
                  Facebook 선택 후 페이지 연결
                </Hint>
              </Step>
              <Step n={3} tab="instagram">
                <strong>developers.facebook.com</strong> 접속 → 우측 상단{" "}
                <strong>"내 앱"</strong> → <strong>"앱 만들기"</strong> →{" "}
                <strong>"비즈니스"</strong> 선택 → 앱 이름 입력 (아무거나) →{" "}
                <strong>"앱 만들기"</strong>
              </Step>
              <Step n={4} tab="instagram">
                앱 대시보드에서 왼쪽 메뉴 <strong>"제품 추가"</strong> →{" "}
                <strong>"Instagram Graph API"</strong> 항목의{" "}
                <strong>"설정"</strong> 클릭
              </Step>
              <Step n={5} tab="instagram">
                상단 메뉴 <strong>"도구"</strong> →{" "}
                <strong>"Graph API Explorer"</strong> 클릭 → 우측 앱
                드롭다운에서 내 앱 선택 → <strong>"권한 추가"</strong>를 눌러
                아래 3가지를 모두 체크 후 <strong>"토큰 생성"</strong> 클릭 →
                Facebook 로그인 후 권한 허용
                <Code tab="instagram">{`instagram_basic\ninstagram_content_publish\npages_read_engagement`}</Code>
                상단에 표시된 토큰(EAA…) 복사 → 이것이{" "}
                <strong>단기 토큰</strong>
              </Step>
              <Step n={6} tab="instagram">
                앱 설정에서 <strong>앱 ID</strong>와 <strong>앱 시크릿</strong>{" "}
                확인
                <Hint>
                  developers.facebook.com → 해당 앱 → 설정 → 기본 설정 → "앱
                  ID"와 "앱 시크릿 코드" 값 복사
                </Hint>
              </Step>
              <Step n={7} tab="instagram">
                <strong>장기 토큰으로 교환</strong> — 아래 URL의 값을 교체한 뒤
                브라우저 주소창에 입력 → 결과의{" "}
                <code className="bg-purple-50 text-purple-700 rounded px-1 text-[12px]">
                  access_token
                </code>{" "}
                값(EAA…)이 <strong>장기 토큰</strong> (60일 유효) → 아래 폼의
                "Meta Access Token"에 붙여넣기
                <Code tab="instagram">{`https://graph.facebook.com/oauth/access_token\n  ?grant_type=fb_exchange_token\n  &client_id=여기에_앱_ID\n  &client_secret=여기에_앱_시크릿\n  &fb_exchange_token=여기에_단기_토큰`}</Code>
              </Step>
              <Step n={8} tab="instagram">
                <strong>Instagram User ID 확인</strong> — Graph API Explorer에서
                아래 순서로 조회
                <Code tab="instagram">{`① 주소창에 입력:\n  /me/accounts?access_token=장기_토큰\n  → 결과에서 "id" 값(숫자) 복사 — 이것이 페이지 ID\n\n② 주소창에 입력:\n  /페이지ID?fields=instagram_business_account&access_token=장기_토큰\n  → 결과의 instagram_business_account.id 값이 User ID\n  → 아래 폼의 "Instagram User ID"에 붙여넣기`}</Code>
              </Step>
            </GuideBox>
          )}

          <FormCard tab="instagram">
            <p className="text-[12px] font-semibold text-[#374151]">
              {igStatus.connected ? "토큰 갱신" : "토큰 입력"}
            </p>
            <Field label="Meta Access Token" required hint="(EAA… 게시·댓글용)">
              <input
                type="password"
                value={metaToken}
                onChange={(e) => setMetaToken(e.target.value)}
                placeholder="EAAxxxxxxxxxx..."
                className={inputCls()}
              />
            </Field>
            <Field label="Instagram User ID" required hint="(숫자 ID)">
              <input
                type="text"
                value={igUserId}
                onChange={(e) => setIgUserId(e.target.value)}
                placeholder="123456789012345"
                className={inputCls()}
              />
            </Field>
            <Field label="Meta IG Access Token" hint="(IGAA… DM 발송용, 선택)">
              <input
                type="password"
                value={metaIgToken}
                onChange={(e) => setMetaIgToken(e.target.value)}
                placeholder="IGAAxxxxxxxxxx..."
                className={inputCls()}
              />
            </Field>
            {igMsg && (
              <p
                className={`text-[12px] ${igMsg.type === "ok" ? "text-green-600" : "text-red-500"}`}
              >
                {igMsg.text}
              </p>
            )}
            <div className="flex items-center">
              {igStatus.connected && (
                <button
                  type="button"
                  onClick={disconnectInstagram}
                  className="text-[12px] text-red-500 hover:text-red-600 font-medium transition-colors"
                >
                  연결 해제
                </button>
              )}
              <Button
                onClick={saveInstagram}
                disabled={igSaving}
                className="ml-auto bg-[#111827] text-white hover:bg-[#374151] text-[13px] px-4 py-2 h-auto rounded-md"
              >
                {igSaving ? "저장 중..." : igStatus.connected ? "갱신" : "저장"}
              </Button>
            </div>
          </FormCard>
        </div>
      )}

      {/* ── 네이버 블로그 ────────────────────────────────────────────────── */}
      {activeTab === "naver" && (
        <div className="flex flex-col gap-4 overflow-y-auto flex-1 min-h-0 pr-0.5">
          {naverStatus.connected ? (
            (() => {
              const updatedAt = naverStatus.updated_at
                ? new Date(naverStatus.updated_at as string)
                : null;
              const expiresAt = updatedAt
                ? new Date(updatedAt.getTime() + 30 * 24 * 60 * 60 * 1000)
                : null;
              const daysLeft = expiresAt
                ? Math.ceil(
                    (expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
                  )
                : null;
              return (
                <div className="rounded-xl border border-green-100 overflow-hidden">
                  <div className="bg-green-50 border-b border-green-100 px-4 py-3 flex items-center gap-2.5">
                    <svg
                      viewBox="0 0 24 24"
                      className="w-4 h-4 shrink-0"
                      fill="#00a64a"
                    >
                      <path d="M16.273 12.845 7.376 0H0v24h7.727V11.155L16.624 24H24V0h-7.727z" />
                    </svg>
                    <span className="text-[13px] font-semibold text-[#111827]">
                      네이버 블로그
                    </span>
                    <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-[11px] font-semibold text-green-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      연결됨
                    </span>
                  </div>
                  <div className="bg-white px-4 py-4 flex flex-col gap-4">
                    <div className="flex flex-col gap-2.5">
                      <div className="flex items-center gap-3 text-[13px]">
                        <span className="w-24 shrink-0 text-[#9ca3af]">
                          블로그 ID
                        </span>
                        <span className="font-medium text-[#111827]">
                          {naverStatus.blog_id as string}
                        </span>
                      </div>
                      {updatedAt && (
                        <div className="flex items-center gap-3 text-[13px]">
                          <span className="w-24 shrink-0 text-[#9ca3af]">
                            쿠키 업데이트
                          </span>
                          <span className="text-[#111827]">
                            {updatedAt.toLocaleDateString("ko-KR")}
                          </span>
                        </div>
                      )}
                      {daysLeft !== null && (
                        <div className="flex items-center gap-3 text-[13px]">
                          <span className="w-24 shrink-0 text-[#9ca3af]">
                            쿠키 만료
                          </span>
                          <span
                            className={
                              daysLeft <= 7
                                ? "text-red-500 font-medium"
                                : daysLeft <= 14
                                  ? "text-amber-600 font-medium"
                                  : "text-[#111827]"
                            }
                          >
                            {daysLeft > 0 ? `${daysLeft}일 후` : "만료됨"}
                          </span>
                        </div>
                      )}
                    </div>
                    {daysLeft !== null && daysLeft <= 7 && (
                      <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-[12px] text-red-600">
                        ⚠️ 쿠키가 곧 만료됩니다. 아래 폼에서 새 쿠키를
                        업로드하세요.
                      </div>
                    )}
                    <div className="rounded-lg bg-[#f9fafb] border border-[#f3f4f6] px-3 py-3">
                      <p className="text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wide mb-2">
                        활성화된 기능
                      </p>
                      <div className="flex flex-col gap-1.5">
                        {["네이버 블로그 자동 업로드", "게시물 예약 발행"].map(
                          (f) => (
                            <div
                              key={f}
                              className="flex items-center gap-2 text-[12px] text-[#374151]"
                            >
                              <svg
                                className="w-3.5 h-3.5 text-green-500 shrink-0"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2.5}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                              {f}
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()
          ) : (
            <StatusBanner connected={false}>
              아직 연결되지 않았습니다. 아래 안내를 따라 쿠키를 발급하세요.
            </StatusBanner>
          )}

          {!naverStatus.connected && (
            <GuideBox tab="naver" title="쿠키 발급 및 연결 방법">
              <Step n={1} tab="naver">
                백엔드 서버(uvicorn)가 <strong>실행 중</strong>인지 먼저
                확인하세요.
                <Hint>
                  실행 명령: uvicorn app.main:app --reload --port 8000
                </Hint>
              </Step>
              <Step n={2} tab="naver">
                <strong>새 터미널</strong>을 열고 아래 명령어를 입력 후 엔터
                <Code tab="naver">{`cd backend\npython -m app.services.naver_login_setup`}</Code>
              </Step>
              <Step n={3} tab="naver">
                잠시 후 <strong>브라우저 창이 자동으로 열립니다</strong> → 열린
                브라우저에서{" "}
                <strong>네이버(naver.com) 아이디·비밀번호로 직접 로그인</strong>
                <Hint>
                  캡차(문자 인증·퍼즐)가 나타나면 직접 해결한 뒤 로그인을
                  완료하세요.
                </Hint>
              </Step>
              <Step n={4} tab="naver">
                로그인이 완료되면 브라우저는 그대로 두고 →{" "}
                <strong>터미널 창으로 돌아와</strong>{" "}
                <strong>엔터(Enter) 키</strong> 입력
              </Step>
              <Step n={5} tab="naver">
                터미널에 <strong>"쿠키 저장 완료"</strong> 메시지가 뜨면 아래
                경로에 파일이 생성된 것입니다.
                <Code tab="naver">{`backend/app/services/naver_cookies.json`}</Code>
              </Step>
              <Step n={6} tab="naver">
                <strong>블로그 ID 확인</strong> — 네이버 블로그에 접속해 내
                블로그 주소의 마지막 부분이 ID입니다.
                <Hint>
                  예) blog.naver.com/<strong>myblog123</strong> → 블로그 ID는
                  myblog123
                </Hint>
              </Step>
              <Step n={7} tab="naver">
                아래 폼에 <strong>블로그 ID 입력</strong> + 5번에서 생성된{" "}
                <strong>naver_cookies.json 파일 업로드</strong> →{" "}
                <strong>"저장"</strong> 클릭
                <Hint>
                  ※ 쿠키는 약 30일 후 만료됩니다. 만료되면 2~5번 과정을 반복해
                  재업로드하세요.
                </Hint>
              </Step>
            </GuideBox>
          )}

          <FormCard tab="naver">
            <p className="text-[12px] font-semibold text-[#374151]">
              {naverStatus.connected ? "쿠키 갱신" : "연결 설정"}
            </p>
            <Field label="블로그 ID" required>
              <input
                type="text"
                value={blogId}
                onChange={(e) => setBlogId(e.target.value)}
                placeholder="myblog123"
                className={inputCls()}
              />
            </Field>
            <Field label="쿠키 파일" required hint="(naver_cookies.json)">
              <input
                ref={cookieFileRef}
                type="file"
                accept=".json,application/json"
                onChange={(e) => setCookieFile(e.target.files?.[0] ?? null)}
                className="text-[12px] text-[#374151] cursor-pointer file:mr-3 file:rounded-md file:border-0 file:bg-[#f3f4f6] file:px-3 file:py-1.5 file:text-[12px] file:text-[#374151] file:font-medium hover:file:bg-[#e5e7eb] transition"
              />
            </Field>
            {naverMsg && (
              <p
                className={`text-[12px] ${naverMsg.type === "ok" ? "text-green-600" : "text-red-500"}`}
              >
                {naverMsg.text}
              </p>
            )}
            <div className="flex items-center">
              {naverStatus.connected && (
                <button
                  type="button"
                  onClick={disconnectNaver}
                  className="text-[12px] text-red-500 hover:text-red-600 font-medium transition-colors"
                >
                  연결 해제
                </button>
              )}
              <Button
                onClick={saveNaver}
                disabled={naverSaving}
                className="ml-auto bg-[#111827] text-white hover:bg-[#374151] text-[13px] px-4 py-2 h-auto rounded-md"
              >
                {naverSaving
                  ? "저장 중..."
                  : naverStatus.connected
                    ? "갱신"
                    : "저장"}
              </Button>
            </div>
          </FormCard>
        </div>
      )}
    </Modal>
  );
};
