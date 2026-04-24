"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Send,
  Trash2,
} from "lucide-react";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type Campaign = {
  id: string;
  post_id: string;
  post_url: string;
  post_thumbnail: string;
  trigger_keyword: string;
  dm_template: string;
  is_active: boolean;
  sent_count: number;
  created_at: string;
};

type SentItem = {
  id: string;
  commenter_ig_id: string;
  commenter_name: string;
  sent_at: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

// ── 유틸 ─────────────────────────────────────────────────────────────────────

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const EMPTY_FORM = {
  post_id: "",
  post_url: "",
  trigger_keyword: "",
  dm_template: "",
};

// ── 컴포넌트 ─────────────────────────────────────────────────────────────────

export const DMCampaignModal = ({ open, onClose }: Props) => {
  const apiBase = process.env.NEXT_PUBLIC_API_URL;
  const [accountId, setAccountId] = useState("");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sentMap, setSentMap] = useState<Record<string, SentItem[]>>({});
  const [sentLoading, setSentLoading] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── accountId ──────────────────────────────────────────────────────────────

  const getAccountId = useCallback(async () => {
    if (accountId) return accountId;
    const sb = createClient();
    const { data } = await sb.auth.getUser();
    const id = data.user?.id ?? "";
    setAccountId(id);
    return id;
  }, [accountId]);

  // ── 목록 로드 ──────────────────────────────────────────────────────────────

  const loadCampaigns = useCallback(async () => {
    const aid = await getAccountId();
    if (!aid) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${apiBase}/api/dm-campaigns/?account_id=${aid}`,
        { cache: "no-store" },
      );
      const json = await res.json();
      setCampaigns(json?.data ?? []);
    } catch {
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, [apiBase, getAccountId]);

  useEffect(() => {
    if (open) loadCampaigns();
  }, [open, loadCampaigns]);

  // ── 수동 스캔 ──────────────────────────────────────────────────────────────

  const handleScan = async () => {
    const aid = await getAccountId();
    if (!aid) return;
    setScanning(true);
    try {
      const res = await fetch(`${apiBase}/api/dm-campaigns/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: aid }),
      });
      const json = await res.json();
      if (json.data) {
        const {
          sent,
          scanned,
          skip_no_id,
          skip_already_sent,
          skip_no_keyword,
          skip_dm_failed,
        } = json.data;
        const skips: string[] = [];
        if (skip_no_id) skips.push(`사용자 ID 없음 ${skip_no_id}개`);
        if (skip_already_sent)
          skips.push(`중복 발송 방지 ${skip_already_sent}개`);
        if (skip_no_keyword) skips.push(`키워드 불일치 ${skip_no_keyword}개`);
        if (skip_dm_failed) skips.push(`DM 발송 실패 ${skip_dm_failed}개`);
        const skipMsg = skips.length
          ? `\n미발송 사유: ${skips.join(", ")}`
          : "";
        alert(
          `스캔 완료 — 댓글 ${scanned}개 확인 / DM ${sent}개 발송${skipMsg}`,
        );
      }
      await loadCampaigns();
    } catch {
      alert("스캔 중 오류가 발생했습니다.");
    } finally {
      setScanning(false);
    }
  };

  // ── 캠페인 생성 ────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (
      !form.post_id.trim() ||
      !form.post_url.trim() ||
      !form.trigger_keyword.trim() ||
      !form.dm_template.trim()
    ) {
      alert("모든 항목을 입력해주세요.");
      return;
    }
    const aid = await getAccountId();
    if (!aid) return;
    setCreating(true);
    try {
      const res = await fetch(`${apiBase}/api/dm-campaigns/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: aid, ...form }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setForm(EMPTY_FORM);
      setShowForm(false);
      await loadCampaigns();
    } catch (e) {
      alert(e instanceof Error ? e.message : "생성 실패");
    } finally {
      setCreating(false);
    }
  };

  // ── 활성화 토글 ────────────────────────────────────────────────────────────

  const handleToggle = async (camp: Campaign) => {
    const aid = await getAccountId();
    if (!aid) return;
    await fetch(`${apiBase}/api/dm-campaigns/${camp.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: aid, is_active: !camp.is_active }),
    });
    setCampaigns((prev) =>
      prev.map((c) =>
        c.id === camp.id ? { ...c, is_active: !camp.is_active } : c,
      ),
    );
  };

  // ── 캠페인 삭제 ────────────────────────────────────────────────────────────

  const handleDelete = async (camp: Campaign) => {
    if (!confirm(`"${camp.trigger_keyword}" 캠페인을 삭제할까요?`)) return;
    const aid = await getAccountId();
    if (!aid) return;
    setDeletingId(camp.id);
    try {
      await fetch(`${apiBase}/api/dm-campaigns/${camp.id}?account_id=${aid}`, {
        method: "DELETE",
      });
      setCampaigns((prev) => prev.filter((c) => c.id !== camp.id));
      if (expandedId === camp.id) setExpandedId(null);
    } finally {
      setDeletingId(null);
    }
  };

  // ── 발송 이력 펼치기 ────────────────────────────────────────────────────────

  const handleExpand = async (camp: Campaign) => {
    if (expandedId === camp.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(camp.id);
    if (sentMap[camp.id]) return;
    const aid = await getAccountId();
    if (!aid) return;
    setSentLoading(camp.id);
    try {
      const res = await fetch(
        `${apiBase}/api/dm-campaigns/${camp.id}/sent?account_id=${aid}&limit=30`,
        { cache: "no-store" },
      );
      const json = await res.json();
      setSentMap((prev) => ({ ...prev, [camp.id]: json?.data ?? [] }));
    } finally {
      setSentLoading(null);
    }
  };

  // ── 렌더 ──────────────────────────────────────────────────────────────────

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="DM Campaign Manager"
      widthClass="w-[720px]"
      variant="dashboard"
    >
      <div className="h-[560px] flex flex-col gap-3">
        {/* 툴바 */}
        <div className="flex items-center justify-between gap-2 shrink-0">
          <p className="text-[12px] text-[#030303]/50">
            댓글에 키워드를 남긴 사용자에게 자동으로 DM을 발송합니다.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleScan}
              disabled={scanning}
              className="rounded-md bg-[#f0ece4] px-3 py-1.5 text-[12px] font-medium text-[#5a5040] hover:bg-[#e5ddd0] disabled:opacity-50"
            >
              {scanning ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  스캔 중…
                </span>
              ) : (
                "지금 스캔"
              )}
            </button>
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="flex items-center gap-1 rounded-md bg-[#7c4daa] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />새 캠페인
            </button>
          </div>
        </div>

        {/* 캠페인 생성 폼 */}
        {showForm && (
          <div className="rounded-[5px] border border-[#7c4daa]/20 bg-[#f7f0ff] p-4 space-y-3 shrink-0">
            <p className="text-[12px] font-semibold text-[#7c4daa]">
              새 캠페인 만들기
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] text-[#5a5040]">
                  게시물 미디어 ID
                </label>
                <input
                  type="text"
                  placeholder="예: 18023456789012345"
                  value={form.post_id}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, post_id: e.target.value }))
                  }
                  className="w-full rounded border border-[#ddd0b4] bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[#7c4daa]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-[#5a5040]">게시물 URL</label>
                <input
                  type="text"
                  placeholder="https://www.instagram.com/p/..."
                  value={form.post_url}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, post_url: e.target.value }))
                  }
                  className="w-full rounded border border-[#ddd0b4] bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[#7c4daa]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-[#5a5040]">
                  트리거 키워드
                </label>
                <input
                  type="text"
                  placeholder="예: 신청, 쿠폰, 정보"
                  value={form.trigger_keyword}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, trigger_keyword: e.target.value }))
                  }
                  className="w-full rounded border border-[#ddd0b4] bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[#7c4daa]"
                />
                <p className="text-[10px] text-[#8c7e66]">
                  댓글에 이 단어가 포함되면 DM을 자동 발송합니다
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-[#5a5040]">DM 내용</label>
                <textarea
                  rows={3}
                  placeholder="안녕하세요! 댓글 감사드려요. 아래 링크로 신청하실 수 있습니다 ↓"
                  value={form.dm_template}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, dm_template: e.target.value }))
                  }
                  className="w-full resize-none rounded border border-[#ddd0b4] bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[#7c4daa]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setForm(EMPTY_FORM);
                }}
                className="rounded-md border border-[#ddd0b4] px-3 py-1.5 text-[12px] text-[#5a5040] hover:bg-[#f0ece4]"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="flex items-center gap-1.5 rounded-md bg-[#7c4daa] px-4 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {creating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                {creating ? "저장 중…" : "캠페인 시작"}
              </button>
            </div>
          </div>
        )}

        {/* 목록 */}
        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-[#030303]/50">
            Loading…
          </div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[#030303]/50">
            <p className="text-sm">Nothing here yet</p>
            <p className="text-[12px]">새 캠페인 버튼을 눌러 시작하세요.</p>
          </div>
        ) : (
          <ScrollArea className="flex-1 pr-1">
            <div className="space-y-0">
              {campaigns.map((camp, i) => {
                const isExpanded = expandedId === camp.id;
                const sentItems = sentMap[camp.id] ?? [];
                const isLoadingSent = sentLoading === camp.id;
                const isDeleting = deletingId === camp.id;

                return (
                  <div key={camp.id}>
                    <div className="py-3 space-y-2">
                      {/* 헤더 행 */}
                      <div className="flex items-center gap-2">
                        {/* 활성 토글 */}
                        <button
                          type="button"
                          onClick={() => handleToggle(camp)}
                          className={`h-5 w-9 rounded-full transition-colors shrink-0 ${
                            camp.is_active ? "bg-[#7c4daa]" : "bg-[#ddd0b4]"
                          }`}
                        >
                          <span
                            className={`block h-4 w-4 rounded-full bg-white shadow transition-transform mx-0.5 ${
                              camp.is_active ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                        <span
                          className={`text-[11px] font-semibold ${
                            camp.is_active ? "text-[#7c4daa]" : "text-[#8c7e66]"
                          }`}
                        >
                          {camp.is_active ? "활성" : "중지"}
                        </span>
                        <span className="mx-1 text-[#ddd0b4]">|</span>
                        <span className="rounded bg-[#f0ece4] px-2 py-0.5 text-[11px] font-semibold text-[#5a5040]">
                          "{camp.trigger_keyword}"
                        </span>
                        <span className="text-[11px] text-[#030303]/40">
                          DM {camp.sent_count}건 발송
                        </span>
                        <span className="ml-auto text-[11px] text-[#030303]/30 shrink-0">
                          {formatDate(camp.created_at)}
                        </span>
                        {/* 삭제 */}
                        <button
                          type="button"
                          onClick={() => handleDelete(camp)}
                          disabled={isDeleting}
                          className="rounded p-1 text-[#030303]/30 hover:bg-[#f0ece4] hover:text-[#cc0000] disabled:opacity-40"
                        >
                          {isDeleting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>

                      {/* 게시물 링크 */}
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-[#030303]/40">
                          게시물:
                        </span>
                        <a
                          href={camp.post_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate max-w-[400px] text-[11px] text-[#3b7aba] underline-offset-2 hover:underline"
                        >
                          {camp.post_url}
                        </a>
                      </div>

                      {/* DM 미리보기 */}
                      <div className="rounded-[5px] bg-[#f8f4ee] px-3 py-2 text-[12px] text-[#030303]/70 whitespace-pre-wrap">
                        {camp.dm_template}
                      </div>

                      {/* 발송 이력 토글 */}
                      <button
                        type="button"
                        onClick={() => handleExpand(camp)}
                        className="flex items-center gap-1 text-[11px] text-[#7c4daa] hover:underline"
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                        발송 이력 보기
                      </button>

                      {/* 발송 이력 */}
                      {isExpanded && (
                        <div className="rounded-[5px] border border-[#ddd0b4] bg-white px-3 py-2 space-y-1.5">
                          {isLoadingSent ? (
                            <div className="flex items-center justify-center py-2 text-[12px] text-[#030303]/40">
                              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                              불러오는 중…
                            </div>
                          ) : sentItems.length === 0 ? (
                            <p className="text-center text-[12px] text-[#030303]/40 py-1">
                              아직 발송 이력이 없습니다.
                            </p>
                          ) : (
                            sentItems.map((s) => (
                              <div
                                key={s.id}
                                className="flex items-center justify-between text-[12px]"
                              >
                                <span className="font-medium text-[#030303]">
                                  {s.commenter_name || s.commenter_ig_id}
                                </span>
                                <span className="text-[#030303]/40">
                                  {formatDate(s.sent_at)}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                    {i < campaigns.length - 1 && <Separator />}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>
    </Modal>
  );
};
