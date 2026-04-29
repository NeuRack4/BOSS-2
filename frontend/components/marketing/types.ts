// frontend/components/marketing/types.ts

export interface InstagramAccount {
  username?: string;
  followers_count: number;
  media_count: number;
  reach: number;
  impressions: number;
  profile_views: number;
  period_days: number;
}

export interface InstagramPost {
  id: string;
  caption: string;
  media_type: string;
  permalink: string;
  reach: number;
  impressions: number;
  engagement: number;
  saved: number;
}

export interface InstagramData {
  account?: InstagramAccount;
  top_posts?: InstagramPost[];
  avg_engagement?: number;
  total_posts_analyzed?: number;
  error?: string;
}

export interface YoutubeChannel {
  views: number;
  watch_minutes: number;
  subscribers_gained: number;
  subscribers_lost: number;
  net_subscribers: number;
  likes: number;
  comments: number;
  period_days: number;
  error?: string;
  needs_reconnect?: boolean;
}

export interface YoutubeVideo {
  video_id: string;
  title: string;
  views: number;
  watch_minutes: number;
  likes: number;
  url: string;
}

export interface YoutubeData {
  channel?: YoutubeChannel;
  top_videos?: YoutubeVideo[];
  error?: string;
}

export interface ActionItem {
  priority: "high" | "medium" | "low";
  category: "instagram" | "youtube" | "content" | "general";
  title: string;
  target: string;
  period: string;
  due_date?: string;
  idea: string;
  steps: string[];
  expected: string;
  why: string;
}

export interface MarketingData {
  instagram: InstagramData;
  youtube: YoutubeData;
  period_days: number;
}

export interface DailyYoutubeData {
  date: string;
  views: number;
  watch_minutes: number;
}

export interface DailyInstagramData {
  date: string;
  reach: number;
}

export interface MarketingAnalysis {
  text: string;
  youtube_daily: DailyYoutubeData[];
  instagram_daily: DailyInstagramData[];
  period_days: number;
}

export interface MarketingDashboardState {
  loading: boolean;
  error: string | null;
  data: MarketingData | null;
  actions: ActionItem[];
  actionsLoading: boolean;
  actionsLoaded: boolean;
  analysis: MarketingAnalysis | null;
  analysisLoading: boolean;
  analysisLoaded: boolean;
}
