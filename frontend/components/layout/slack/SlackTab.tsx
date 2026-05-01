"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function SlackTab() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 컴포넌트 언마운트 시 폴링 정리
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id ?? null;
      setAccountId(uid);
      if (uid) fetchStatus(uid);
    });
  }, []);

  // localStorage 신호 감지 — 새 탭 OAuth 완료 시 자동 상태 갱신
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "slack_connected_signal" && accountId) {
        fetchStatus(accountId);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [accountId]);

  const fetchStatus = (uid: string) => {
    fetch(`${API}/api/slack/status?account_id=${uid}`)
      .then((r) => r.json())
      .then((res) => {
        setConnected(res.connected);
        setTeamName(res.team_name ?? "");
      })
      .finally(() => setLoading(false));
  };

  const handleConnect = async () => {
    if (!accountId) return;
    const res = await fetch(
      `${API}/api/slack/oauth/url?account_id=${accountId}`,
    );
    const { url } = await res.json();
    window.open(url, "_blank", "noopener,noreferrer");

    // noopener 환경에서 storage 이벤트가 발화 안 될 수 있어 폴링으로 보완
    if (pollRef.current) clearInterval(pollRef.current); // 기존 폴링 중단
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      const r = await fetch(`${API}/api/slack/status?account_id=${accountId}`);
      const data = await r.json();
      if (data.connected) {
        setConnected(true);
        setTeamName(data.team_name ?? "");
        clearInterval(pollRef.current!);
        pollRef.current = null;
      }
      if (attempts >= 20) {
        clearInterval(pollRef.current!);
        pollRef.current = null;
      }
    }, 2000);
  };

  const handleDisconnect = async () => {
    if (!accountId) return;
    await fetch(`${API}/api/slack/disconnect?account_id=${accountId}`, {
      method: "DELETE",
    });
    setConnected(false);
    setTeamName("");
  };

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-[13px] text-[#aaa]">
        불러오는 중…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-1">
      <div className="flex items-center gap-3">
        <svg width="32" height="32" viewBox="0 0 54 54" fill="none">
          <path
            d="M19.712.133a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386h5.376V5.52A5.381 5.381 0 0 0 19.712.133m0 14.365H5.376A5.381 5.381 0 0 0 0 19.884a5.381 5.381 0 0 0 5.376 5.387h14.336a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386"
            fill="#36C5F0"
          />
          <path
            d="M53.76 19.884a5.381 5.381 0 0 0-5.376-5.386 5.381 5.381 0 0 0-5.376 5.386v5.387h5.376a5.381 5.381 0 0 0 5.376-5.387m-14.336 0V5.52A5.381 5.381 0 0 0 34.048.133a5.381 5.381 0 0 0-5.376 5.387v14.364a5.381 5.381 0 0 0 5.376 5.387 5.381 5.381 0 0 0 5.376-5.387"
            fill="#2EB67D"
          />
          <path
            d="M34.048 54a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386h-5.376v5.386A5.381 5.381 0 0 0 34.048 54m0-14.365h14.336a5.381 5.381 0 0 0 5.376-5.386 5.381 5.381 0 0 0-5.376-5.387H34.048a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386"
            fill="#ECB22E"
          />
          <path
            d="M0 34.249a5.381 5.381 0 0 0 5.376 5.386 5.381 5.381 0 0 0 5.376-5.386v-5.387H5.376A5.381 5.381 0 0 0 0 34.249m14.336 0v14.364A5.381 5.381 0 0 0 19.712 54a5.381 5.381 0 0 0 5.376-5.387V34.249a5.381 5.381 0 0 0-5.376-5.387 5.381 5.381 0 0 0-5.376 5.387"
            fill="#E01E5A"
          />
        </svg>
        <div>
          <p className="text-[14px] font-semibold text-[#2c2c2c]">Slack 연동</p>
          <p className="text-[12px] text-[#888]">
            매일 설정한 시간에 매출 알림을 Slack DM으로 받아보세요.
          </p>
        </div>
      </div>
      <div className="rounded-[6px] bg-[#f8f8f8] border border-[#eee] px-3 py-2.5 text-[11px] text-[#888] leading-relaxed">
        💡 Slack 계정과 워크스페이스가 필요해요.
        <br />
        Slack이 처음이라면{" "}
        <a
          href="https://slack.com/get-started"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#4A154B] underline hover:opacity-70"
        >
          slack.com
        </a>
        에서 무료로 가입 후 워크스페이스를 만들어보세요.
      </div>

      {connected ? (
        <div className="rounded-[6px] border border-[#e0f5ea] bg-[#f6fdf8] px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-[13px] font-semibold text-[#2e7d32]">
              ✅ 연결됨
            </p>
            {teamName && (
              <p className="text-[11px] text-[#888]">{teamName} 워크스페이스</p>
            )}
          </div>
          <button
            onClick={handleDisconnect}
            className="rounded-[4px] border border-[#ccc] px-3 py-1 text-[12px] text-[#666] hover:bg-[#f5f5f5]"
          >
            연결 해제
          </button>
        </div>
      ) : (
        <button
          onClick={handleConnect}
          className="flex items-center justify-center gap-2 rounded-[6px] bg-[#4A154B] px-4 py-2.5 text-[13px] font-medium text-white hover:bg-[#3e1140] transition"
        >
          <span>Slack으로 연결하기</span>
        </button>
      )}
    </div>
  );
}
