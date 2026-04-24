"use client";

import Link from "next/link";
import { Modal } from "@/components/ui/modal";

type Props = { open: boolean; onClose: () => void };

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "무료",
    priceNote: "",
    description: "개인 사용자 또는 기능 체험용",
    features: [
      "AI 채팅 (월 50회)",
      "인스타그램 게시물 자동 업로드",
      "네이버 블로그 자동 업로드",
      "아티팩트 저장 (최대 20개)",
      "스케줄 등록 (최대 3개)",
    ],
    limits: ["유튜브 업로드 불가", "DM 캠페인 불가"],
    cta: "무료로 시작하기",
    highlight: false,
  },
  {
    id: "pro",
    name: "Pro",
    price: "29,900",
    priceNote: "원 / 월",
    description: "모든 기능을 제한 없이 사용",
    features: [
      "AI 채팅 무제한",
      "인스타그램 · 네이버 블로그 자동 업로드",
      "유튜브 쇼츠 자동 업로드",
      "Instagram DM 자동 캠페인",
      "아티팩트 저장 무제한",
      "스케줄 등록 무제한",
      "장기 메모리 (무제한 보관)",
      "우선 고객 지원",
    ],
    limits: [],
    cta: "Pro 시작하기",
    highlight: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "99,900",
    priceNote: "원 / 월",
    description: "팀 단위 사용 및 기업 고객용",
    features: [
      "Pro 플랜 모든 기능 포함",
      "팀원 계정 최대 10명",
      "플랫폼 연결 계정 공유",
      "전용 온보딩 지원",
      "맞춤형 기능 요청 가능",
      "SLA 보장 지원",
    ],
    limits: [],
    cta: "Enterprise 시작하기",
    highlight: false,
  },
] as const;

export const PricingPreviewModal = ({ open, onClose }: Props) => {
  return (
    <Modal open={open} onClose={onClose} title="요금제" widthClass="w-[720px]">
      <p className="mb-5 text-[13px] text-[#6b7280]">
        모든 플랜은 회원가입 후 바로 사용할 수 있습니다. 신용카드 없이 Free 플랜으로 시작해보세요.
      </p>

      <div className="grid grid-cols-3 gap-4">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={`relative flex flex-col rounded-xl border px-4 py-5 gap-4 ${
              plan.highlight ? "border-[#111827] shadow-md" : "border-[#e5e7eb]"
            }`}
          >
            {plan.highlight && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#111827] text-white text-[11px] font-semibold px-3 py-0.5 rounded-full">
                추천
              </span>
            )}

            <div>
              <p className="text-[13px] font-semibold text-[#374151]">{plan.name}</p>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-[22px] font-bold text-[#111827]">{plan.price}</span>
                {plan.priceNote && (
                  <span className="text-[12px] text-[#9ca3af]">{plan.priceNote}</span>
                )}
              </div>
              <p className="mt-1 text-[12px] text-[#6b7280]">{plan.description}</p>
            </div>

            <div className="border-t border-[#f3f4f6]" />

            <ul className="flex flex-col gap-2 flex-1">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-[12px] text-[#374151]">
                  <svg className="w-3.5 h-3.5 shrink-0 mt-0.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {f}
                </li>
              ))}
              {plan.limits.map((l) => (
                <li key={l} className="flex items-start gap-2 text-[12px] text-[#9ca3af]">
                  <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  {l}
                </li>
              ))}
            </ul>

            <Link
              href="/signup"
              onClick={onClose}
              className={`w-full text-center text-[13px] py-2 rounded-lg font-medium transition-colors ${
                plan.highlight
                  ? "bg-[#111827] text-white hover:bg-[#374151]"
                  : "bg-white border border-[#d1d5db] text-[#374151] hover:bg-[#f9fafb]"
              }`}
            >
              {plan.cta}
            </Link>
          </div>
        ))}
      </div>

      <p className="mt-4 text-center text-[11px] text-[#9ca3af]">
        Pro · Enterprise 플랜은 회원가입 후 대시보드에서 구독할 수 있습니다. · 문의: contact@boss2.kr
      </p>
    </Modal>
  );
};
