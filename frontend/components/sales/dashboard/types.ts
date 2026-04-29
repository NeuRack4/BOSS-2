// frontend/components/sales/dashboard/types.ts

export type DashboardStage = 0 | 1 | 2;
// 0: 데이터 없음 (온보딩) | 1: 1~4건 (외삽) | 2: 5건 이상 (정상)

export type PeriodKey = "today" | "week" | "month";

export type DayPoint = {
  date: string; // "YYYY-MM-DD"
  day: number;
  sales: number;
  costs: number;
  profit: number;
};

export type DailyData = {
  date: string;
  amount: number;
  isEstimated: boolean;
};

export type GoalData = {
  monthly_goal: number;
  current_sales: number;
  achievement_rate: number | null;
  remaining: number | null;
};

export type CategoryItem = {
  category: string;
  amount: number;
  pct: number;
};

export type AIResult = {
  summary: string;
  highlights: { type: "positive" | "warning" | "insight"; text: string }[];
  action: string;
};

export type InsightData = {
  growth_stage: "early" | "growing" | "stable";
  months_of_data: number;
  ai_result: AIResult | null;
  narrative: string;
  monthly_prediction: number | null;
};

export type OverviewData = {
  year: number;
  month: number;
  sales: {
    total: number;
    prev_total: number;
    change_rate: number | null;
    daily_avg: number;
  };
  costs: { total: number; prev_total: number; change_rate: number | null };
  profit: { total: number; prev_total: number; change_rate: number | null };
};

export type DashboardState = {
  stage: DashboardStage;
  entryCount: number;
  businessStartDate: string | null;
  todayRevenue: number;
  todayChangeRate: number | null;
  weeklyData: DailyData[];
  goal: GoalData | null;
  overview: OverviewData | null;
  categories: CategoryItem[];
  aiInsight: InsightData | null;
  menus: MenuItem[];
  loading: boolean;
  error: boolean;
};

export type MenuItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  cost_price: number;
  margin_rate: number | null;
  margin_amount: number | null;
  is_active: boolean;
};

export type PeriodActivation = {
  today: boolean;
  week: boolean;
  month: boolean;
  weekTooltip: string;
  monthTooltip: string;
};
