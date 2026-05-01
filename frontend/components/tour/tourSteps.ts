export type TourIconName =
  | "MessageSquare"
  | "Megaphone"
  | "Users"
  | "TrendingUp"
  | "FileText"
  | "Store"
  | "Brain"
  | "Clock"
  | "Calendar"
  | "Zap"
  | "StickyNote"
  | "Target";

export type TourStep = {
  id: string;
  title: string;
  iconName: TourIconName;
  description: string;
};

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "chat",
    title: "Chat",
    iconName: "MessageSquare",
    description: "BOSS AI와 대화하는 메인 공간. 채용·마케팅·매출 등 자연어로 요청하면 자동으로 처리해줍니다.",
  },
  {
    id: "marketing",
    title: "마케팅",
    iconName: "Megaphone",
    description: "인스타그램·네이버 블로그·유튜브 콘텐츠를 AI가 자동으로 기획하고 발행합니다.",
  },
  {
    id: "recruitment",
    title: "채용",
    iconName: "Users",
    description: "채용 공고 작성, 이력서 검토, 면접 일정 관리를 한 곳에서 처리합니다.",
  },
  {
    id: "sales",
    title: "매출",
    iconName: "TrendingUp",
    description: "일매출 입력·분석·목표 추적과 메뉴별 수익성을 한눈에 확인합니다.",
  },
  {
    id: "documents",
    title: "서류",
    iconName: "FileText",
    description: "계약서·공지문·지원서류를 AI가 자동으로 작성하고 저장합니다.",
  },
  {
    id: "profiles",
    title: "프로필",
    iconName: "Store",
    description: "사업장 정보와 목표를 설정합니다. 프로필이 상세할수록 AI 답변이 정확해집니다.",
  },
  {
    id: "longterm-memory",
    title: "장기 메모리",
    iconName: "Brain",
    description: "AI가 누적 학습한 내 사업장 인사이트를 확인하고 관리합니다.",
  },
  {
    id: "chat-history",
    title: "대화 기록",
    iconName: "Clock",
    description: "이전 대화 세션을 다시 불러와 확인할 수 있습니다.",
  },
  {
    id: "upcoming-schedule",
    title: "예정 일정",
    iconName: "Calendar",
    description: "자동화 스케줄과 예약된 AI 작업 목록을 확인합니다.",
  },
  {
    id: "recent-activity",
    title: "최근 활동",
    iconName: "Zap",
    description: "AI가 처리한 작업 로그와 결과를 시간순으로 확인합니다.",
  },
  {
    id: "memos",
    title: "메모",
    iconName: "StickyNote",
    description: "빠른 메모를 저장하고 AI가 필요할 때 참고합니다.",
  },
  {
    id: "subsidy-matches",
    title: "지원사업 매칭",
    iconName: "Target",
    description: "내 사업장 정보 기반으로 적합한 정부 지원사업을 자동 추천합니다.",
  },
];
