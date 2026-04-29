"use client";

import { useEffect } from "react";

export default function SlackSuccessPage() {
  useEffect(() => {
    // 원본 탭에 연결 완료 신호 전송
    localStorage.setItem("slack_connected_signal", Date.now().toString());
    // 새 탭 자동 닫기
    window.close();
  }, []);

  return (
    <div className="flex h-screen items-center justify-center text-[14px] text-slate-500">
      Slack 연결 완료! 이 창을 닫는 중…
    </div>
  );
}
