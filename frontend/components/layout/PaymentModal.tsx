"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

type Props = { open: boolean; onClose: () => void };

/* ── 요금제 ─────────────────────────────────────────────────────────────── */
const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "₩0",
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
    cta: "현재 플랜",
    current: true,
    highlight: false,
  },
  {
    id: "pro",
    name: "Pro",
    price: "29,900",
    priceNote: "₩ / Month",
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
    current: false,
    highlight: true,
  },
  {
    id: "business",
    name: "Enterprise",
    price: "99,900",
    priceNote: "₩ / Month",
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
    current: false,
    highlight: false,
  },
] as const;

/* ── 채널 키 (정적 접근 필수 — Next.js 브라우저에서 동적 process.env[key] 불가) */
const CARD_CHANNEL_KEY = process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY_CARD ?? "";
const KAKAOPAY_CHANNEL_KEY =
  process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY_KAKAOPAY ?? "";
const TOSSPAY_CHANNEL_KEY =
  process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY_TOSSPAY ?? "";
const PAYCO_CHANNEL_KEY =
  process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY_PAYCO ?? "";

/* ── 결제 수단 (일반결제 requestPayment — 자동결제 아님) ─────────────────── */
const PAYMENT_METHODS = [
  {
    id: "card",
    channelKey: CARD_CHANNEL_KEY,
    label: "신용·체크카드",
    desc: "국내외 모든 카드 사용 가능",
    payMethod: "CARD" as const,
    easyPayProvider: undefined,
    icon: (
      <svg
        className="w-6 h-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
        <path strokeLinecap="round" d="M6 15h4" />
      </svg>
    ),
  },
  {
    id: "kakaopay",
    label: "카카오페이",
    desc: "카카오페이 앱으로 간편 결제",
    payMethod: "EASY_PAY" as const,
    easyPayProvider: "KAKAOPAY" as const,
    channelKey: KAKAOPAY_CHANNEL_KEY,
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24">
        <rect width="24" height="24" rx="12" fill="#FEE500" />
        <path
          d="M12 5.5C8.134 5.5 5 7.91 5 10.875c0 1.89 1.2 3.555 3.02 4.56l-.77 2.87 3.34-2.2c.46.065.93.1 1.41.1 3.866 0 7-2.41 7-5.375S15.866 5.5 12 5.5z"
          fill="#3A1D1D"
        />
      </svg>
    ),
  },
  {
    id: "tosspay",
    label: "토스페이",
    desc: "토스 앱으로 간편 결제",
    payMethod: "EASY_PAY" as const,
    easyPayProvider: "TOSSPAY" as const,
    channelKey: TOSSPAY_CHANNEL_KEY,
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24">
        <rect width="24" height="24" rx="6" fill="#0064FF" />
        <path
          d="M7 12.5C7 10 9 8 12 8s5 2 5 4.5-2 4.5-5 4.5c-.8 0-1.6-.15-2.3-.4L7 17.5V12.5z"
          fill="white"
        />
      </svg>
    ),
  },
  {
    id: "payco",
    label: "페이코",
    desc: "PAYCO 앱으로 간편 결제",
    payMethod: "EASY_PAY" as const,
    easyPayProvider: "PAYCO" as const,
    channelKey: PAYCO_CHANNEL_KEY,
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24">
        <rect width="24" height="24" rx="6" fill="#E1251B" />
        <text
          x="4"
          y="17"
          fontSize="10"
          fontWeight="bold"
          fill="white"
          fontFamily="Arial"
        >
          PAY
        </text>
      </svg>
    ),
  },
];

/* ── 결제 수단 선택 모달 ─────────────────────────────────────────────────── */
const PLAN_INFO = {
  pro: {
    label: "Pro",
    amount: 29900,
    orderName: "BOSS2 Pro 구독 (1개월)",
    display: "29,900",
  },
  business: {
    label: "Enterprise",
    amount: 99900,
    orderName: "BOSS2 Enterprise 구독 (1개월)",
    display: "99,900",
  },
};

const PaymentMethodModal = ({
  open,
  onClose,
  accountId,
  userEmail,
  plan,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  userEmail: string;
  plan: "pro" | "business";
  onSuccess: () => void;
}) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const planInfo = PLAN_INFO[plan];

  const handlePay = async () => {
    if (!selected) return;
    const method = PAYMENT_METHODS.find((m) => m.id === selected)!;
    setLoading(true);
    setError(null);

    try {
      // PortOne V2 일반결제 (requestPayment) — 자동결제 아님
      const { requestPayment } = await import("@portone/browser-sdk/v2");

      const paymentId = `boss2-${accountId.slice(0, 8)}-${Date.now()}`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (
        requestPayment as (req: unknown) => Promise<unknown>
      )({
        storeId: process.env.NEXT_PUBLIC_PORTONE_STORE_ID ?? "",
        channelKey: method.channelKey,
        paymentId,
        orderName: planInfo.orderName,
        totalAmount: planInfo.amount,
        currency: "KRW",
        payMethod: method.payMethod,
        ...(method.easyPayProvider
          ? { easyPay: { easyPayProvider: method.easyPayProvider } }
          : {}),
        customer: {
          customerId: accountId,
          email: userEmail,
        },
      });

      if (!result || (typeof result === "object" && "code" in result)) {
        setError(
          (result as { message?: string })?.message ?? "결제가 취소되었습니다.",
        );
        return;
      }

      // 백엔드에 결제 확인 + 구독 활성화
      const res = await fetch(`${API}/api/payment/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          payment_id: paymentId,
          billing_method: selected,
          plan,
        }),
      });

      if (!res.ok) {
        const d = await res.json();
        setError(d.detail ?? "결제 처리 중 오류가 발생했습니다.");
        return;
      }

      onSuccess();
      onClose(); // 결제 성공 시에만 모달 닫기
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="결제 수단 선택"
      widthClass="w-[400px]"
      variant="white"
    >
      <p className="text-[13px] text-[#6b7280] mb-4">
        {planInfo.label} 플랜 ·{" "}
        <strong className="text-[#111827]">{planInfo.display}원 / 월</strong> ·
        언제든지 해지 가능
      </p>

      <div className="flex flex-col gap-2">
        {PAYMENT_METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setSelected(m.id)}
            className={`flex items-center gap-4 rounded-xl border px-4 py-3.5 text-left transition-all ${
              selected === m.id
                ? "border-[#111827] bg-[#f9fafb] shadow-sm"
                : "border-[#e5e7eb] hover:border-[#d1d5db] hover:bg-[#fafafa]"
            }`}
          >
            <div className="shrink-0">{m.icon}</div>
            <div className="flex-1">
              <p className="text-[13px] font-medium text-[#111827]">
                {m.label}
              </p>
              <p className="text-[12px] text-[#9ca3af]">{m.desc}</p>
            </div>
            <div
              className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${
                selected === m.id
                  ? "border-[#111827] bg-[#111827]"
                  : "border-[#d1d5db]"
              }`}
            >
              {selected === m.id && (
                <div className="w-1.5 h-1.5 rounded-full bg-white" />
              )}
            </div>
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-3 text-[12px] text-red-500 text-center">{error}</p>
      )}

      <div className="mt-5 flex gap-2">
        <Button
          onClick={onClose}
          disabled={loading}
          className="flex-1 bg-[#f3f4f6] text-[#374151] hover:bg-[#e5e7eb] text-[13px] py-2 h-auto rounded-lg"
        >
          취소
        </Button>
        <Button
          onClick={handlePay}
          disabled={!selected || loading}
          className="flex-1 bg-[#111827] text-white hover:bg-[#374151] disabled:opacity-40 disabled:cursor-not-allowed text-[13px] py-2 h-auto rounded-lg"
        >
          {loading ? "처리 중..." : "결제하기"}
        </Button>
      </div>

      <p className="mt-3 text-center text-[11px] text-[#9ca3af]">
        결제 정보는 암호화되어 안전하게 처리됩니다.
      </p>
    </Modal>
  );
};

/* ── 메인 요금제 모달 ────────────────────────────────────────────────────── */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const PaymentModal = ({ open, onClose }: Props) => {
  const supabase = createClient();
  const [accountId, setAccountId] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [methodOpen, setMethodOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<"pro" | "business">("pro");
  const [subscription, setSubscription] = useState<{
    plan: string;
    status: string;
    next_billing_date?: string;
  } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setAccountId(data.user.id);
        setUserEmail(data.user.email ?? "");
      }
    });
  }, []);

  useEffect(() => {
    if (open && accountId) fetchSubscription();
  }, [open, accountId]);

  const fetchSubscription = async () => {
    const res = await fetch(
      `${API}/api/payment/status?account_id=${accountId}`,
    );
    const data = await res.json();
    setSubscription(data);
  };

  const currentPlan = subscription?.plan ?? "free";

  const handleCta = (planId: string) => {
    if (planId === "free" || planId === currentPlan) return;
    setSelectedPlan(planId as "pro" | "business");
    setMethodOpen(true);
  };

  const handleUnsubscribe = async () => {
    if (
      !confirm(
        "구독을 해지하시겠습니까? 현재 결제 주기가 끝날 때까지 Pro 기능을 사용할 수 있습니다.",
      )
    )
      return;
    await fetch(`${API}/api/payment/unsubscribe?account_id=${accountId}`, {
      method: "DELETE",
    });
    fetchSubscription();
  };

  return (
    <Modal open={open} onClose={onClose} title="요금제" widthClass="w-[720px]" variant="white">
      {/* 현재 플랜 */}
      <div className="mb-5 flex items-center gap-3 rounded-lg bg-[#f9fafb] border border-[#e5e7eb] px-4 py-3">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
        <span className="text-[13px] text-[#374151]">
          현재 플랜:{" "}
          <strong>
            {currentPlan === "pro"
              ? "Pro"
              : currentPlan === "business"
                ? "Enterprise"
                : "Free"}
          </strong>
          {subscription?.next_billing_date && (
            <span className="ml-2 text-[12px] text-[#9ca3af]">
              다음 결제일:{" "}
              {new Date(subscription.next_billing_date).toLocaleDateString(
                "ko-KR",
              )}
            </span>
          )}
        </span>
        {currentPlan !== "free" && subscription?.status === "active" && (
          <button
            type="button"
            onClick={handleUnsubscribe}
            className="ml-auto text-[11px] text-red-500 hover:underline shrink-0"
          >
            구독 해지
          </button>
        )}
        {subscription?.status === "cancelled" && (
          <span className="ml-auto text-[11px] text-[#9ca3af]">
            해지 예정 (기간 만료까지 유지)
          </span>
        )}
        {subscription?.status === "past_due" && (
          <span className="ml-auto text-[11px] text-red-500">
            결제 실패 — 결제 수단을 확인해주세요
          </span>
        )}
      </div>

      {/* 플랜 카드 */}
      <div className="grid grid-cols-3 gap-4">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === currentPlan;
          return (
            <div
              key={plan.id}
              className="relative flex flex-col rounded-xl border border-[#e5e7eb] px-4 py-5 gap-4"
            >

              <div>
                <p className="text-[18px] font-bold text-[#111827]">
                  {plan.name}
                </p>
                <div className="mt-1 flex min-h-[36px] items-baseline gap-1">
                  <span className="text-[22px] font-bold text-[#111827]">
                    {plan.price}
                  </span>
                  {plan.priceNote && (
                    <span className="text-[15px] font-medium text-[#374151]">
                      {plan.priceNote}
                    </span>
                  )}
                </div>
              </div>

              <div className="border-t border-[#f3f4f6]" />

              <ul className="flex flex-col gap-2 flex-1">
                {plan.features.map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-2 text-[12px] text-[#374151]"
                  >
                    <svg
                      className="w-3.5 h-3.5 shrink-0 mt-0.5 text-green-500"
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
                  </li>
                ))}
                {plan.limits.map((l) => (
                  <li
                    key={l}
                    className="flex items-start gap-2 text-[12px] text-[#9ca3af]"
                  >
                    <svg
                      className="w-3.5 h-3.5 shrink-0 mt-0.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                    {l}
                  </li>
                ))}
              </ul>

              <Button
                onClick={() => handleCta(plan.id)}
                disabled={
                  isCurrent ||
                  plan.id === "free" ||
                  subscription?.status === "cancelled"
                }
                className={`w-full text-[13px] py-2 h-auto rounded-lg ${
                  isCurrent || plan.id === "free"
                    ? "bg-[#f3f4f6] text-[#9ca3af] cursor-default"
                    : plan.highlight
                      ? "bg-[#111827] text-white hover:bg-[#374151]"
                      : "bg-white border border-[#d1d5db] text-[#374151] hover:bg-[#f9fafb]"
                }`}
              >
                {isCurrent
                  ? "현재 플랜"
                  : plan.id === "free"
                    ? "기본 플랜"
                    : plan.cta}
              </Button>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-center text-[11px] text-[#9ca3af]">
        Pro 플랜은 월 단위 구독이며 언제든지 해지 가능합니다. · 문의:
        contact@boss2.kr
      </p>

      <PaymentMethodModal
        open={methodOpen}
        onClose={() => setMethodOpen(false)}
        accountId={accountId}
        userEmail={userEmail}
        plan={selectedPlan}
        onSuccess={fetchSubscription}
      />
    </Modal>
  );
};
