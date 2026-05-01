// frontend/components/onboarding/steps.ts

export type TooltipPosition = "top" | "bottom" | "left" | "right";

export type OnboardingStep = {
  target: string;           // data-tour 값
  title: string;
  description: string;
  position: TooltipPosition;
  action?: "open-node-detail-sample";
};

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    target: "chat-input",
    title: "💬 AI 채팅",
    description: "BOSS에게 매출 분석, 직원 관리, 마케팅 전략을 말로 요청하세요.",
    position: "top",
  },
  {
    target: "domain-nav",
    title: "📍 도메인 메뉴",
    description: "매출·채용·마케팅·문서 4개 도메인을 전환하며 각 분야 AI 기능을 사용하세요.",
    position: "right",
  },
  {
    target: "artifact-canvas",
    title: "🗂 아티팩트 캔버스",
    description: "AI에게 요청하면 결과물(채용공고, 마케팅 리포트 등)이 카드로 생성됩니다.",
    position: "left",
  },
  {
    target: "artifact-canvas",
    title: "🔍 상세 보기",
    description: "카드를 클릭하면 상세 내용을 확인하고 편집·다운로드할 수 있어요.",
    position: "top",
    action: "open-node-detail-sample",
  },
  {
    target: "schedule-toggle",
    title: "⏰ 스케줄 자동화",
    description: "스케줄을 켜면 AI가 정해진 시간에 자동으로 작업을 실행해요.",
    position: "left",
  },
  {
    target: "profile-menu",
    title: "👤 프로필 설정",
    description: "업종·지역·목표를 설정하면 AI가 더 정확한 맞춤 제안을 드려요.",
    position: "bottom",
  },
  {
    target: "memory-badge",
    title: "🧠 장기 기억",
    description: "BOSS는 대화 내용을 장기 기억에 저장해 다음 대화에도 맥락을 유지해요.",
    position: "bottom",
  },
];

export const ONBOARDING_COMPLETION_MESSAGE =
  "안녕하세요! 저는 BOSS예요! 매출 분석, 채용 관리, 마케팅, 서류 작성까지 — 무엇이든 말씀해 주세요! [CHOICES] 매출 관리 요청하기/채용 관리 요청하기/마케팅 요청하기/서류 작성 요청하기[CHOICES]";
