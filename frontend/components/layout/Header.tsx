"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { ScheduleManagerModal } from "@/components/layout/ScheduleManagerModal";
import { ActivityModal } from "@/components/layout/ActivityModal";
import { ChatHistoryModal } from "@/components/layout/ChatHistoryModal";
import { ProfileModal } from "@/components/layout/ProfileModal";
import { LongTermMemoryModal } from "@/components/layout/LongTermMemoryModal";
import { MemosModal } from "@/components/layout/MemosModal";
import { NoticeModal } from "@/components/layout/NoticeModal";
import { SubsidyModal } from "@/components/layout/SubsidyModal";
import { IntegrationsModal } from "@/components/layout/IntegrationsModal";
import { PaymentModal } from "@/components/layout/PaymentModal";
import { SearchPalette } from "@/components/search/SearchPalette";
import { useLayout } from "@/components/bento/LayoutContext";
import { COLOR_SETS } from "@/components/bento/colorSets";
import { CalendarDays, Activity as ActivityIcon, Bell } from "lucide-react";

type HeaderProps = {
  sidebar?: boolean;
};

export const Header = ({ sidebar = false }: HeaderProps = {}) => {
  const router = useRouter();
  const supabase = createClient();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [longMemOpen, setLongMemOpen] = useState(false);
  const [memosOpen, setMemosOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [subsidyOpen, setSubsidyOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [integrationsInitialTab, setIntegrationsInitialTab] = useState<
    "youtube" | "instagram" | "naver" | "slack" | undefined
  >(undefined);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const layoutCtx = useLayout();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onOpenSchedule = () => setScheduleOpen(true);
    const onOpenActivity = () => setActivityOpen(true);
    const onOpenChatHistory = () => setChatHistoryOpen(true);
    const onOpenProfile = () => setProfileOpen(true);
    const onOpenLongMem = () => setLongMemOpen(true);
    const onOpenMemos = () => setMemosOpen(true);
    const onOpenNotice = () => setNoticeOpen(true);
    const onOpenSubsidy = () => setSubsidyOpen(true);
    const onOpenIntegrations = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab as
        | "youtube"
        | "instagram"
        | "naver"
        | "slack"
        | undefined;
      setIntegrationsInitialTab(tab);
      setIntegrationsOpen(true);
    };

    // Slack OAuth 완료 후 리다이렉트 시 Connect 모달 자동 오픈
    if (window.location.search.includes("slack_connected=true")) {
      window.history.replaceState({}, "", window.location.pathname);
      setIntegrationsInitialTab("slack");
      setIntegrationsOpen(true);
    }
    window.addEventListener("boss:open-schedule-modal", onOpenSchedule);
    window.addEventListener("boss:open-activity-modal", onOpenActivity);
    window.addEventListener("boss:open-chat-history-modal", onOpenChatHistory);
    window.addEventListener("boss:open-profile-modal", onOpenProfile);
    window.addEventListener("boss:open-longmem-modal", onOpenLongMem);
    window.addEventListener("boss:open-memos-modal", onOpenMemos);
    window.addEventListener("boss:open-notice-modal", onOpenNotice);
    window.addEventListener("boss:open-subsidy-modal", onOpenSubsidy);
    window.addEventListener("boss:open-integrations-modal", onOpenIntegrations);
    return () => {
      window.removeEventListener("boss:open-schedule-modal", onOpenSchedule);
      window.removeEventListener("boss:open-activity-modal", onOpenActivity);
      window.removeEventListener(
        "boss:open-chat-history-modal",
        onOpenChatHistory,
      );
      window.removeEventListener("boss:open-profile-modal", onOpenProfile);
      window.removeEventListener("boss:open-longmem-modal", onOpenLongMem);
      window.removeEventListener("boss:open-memos-modal", onOpenMemos);
      window.removeEventListener("boss:open-notice-modal", onOpenNotice);
      window.removeEventListener("boss:open-subsidy-modal", onOpenSubsidy);
      window.removeEventListener(
        "boss:open-integrations-modal",
        onOpenIntegrations,
      );
    };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const logo = (
    <Link
      href="/dashboard"
      aria-label="BOSS Dashboard"
      className="flex items-center rounded-sm transition-opacity hover:opacity-80 focus:outline-none focus:ring-1 focus:ring-[#bfae8a] shrink-0"
    >
      <Image
        src="/boss-logo.png"
        alt="BOSS"
        width={1172}
        height={473}
        priority
        unoptimized
        className="h-8 w-auto"
      />
    </Link>
  );

  const layoutBtn = layoutCtx && (
    <Button
      variant="ghost"
      size="sm"
      onClick={
        layoutCtx.isEditing ? layoutCtx.cancelEditing : layoutCtx.startEditing
      }
      className={
        layoutCtx.isEditing
          ? "hidden sm:flex bg-[#ebe0ca] text-[#2e2719]"
          : "hidden sm:flex text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
      }
    >
      Layout
    </Button>
  );

  return (
    <header className="relative h-12 bg-transparent text-[#2e2719] shrink-0 z-50 px-4 md:px-6">
      {/* Search bar — absolutely centered */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="pointer-events-auto flex items-center gap-2 w-[420px] max-w-[60vw] rounded-md border border-[#ddd0b4] bg-[#ebe0ca]/40 px-3 py-1.5 text-[12px] text-[#8c7e66] hover:bg-[#ebe0ca] hover:text-[#5a5040] transition-colors"
        >
          <span className="flex-1 text-left">Search…</span>
          <kbd className="font-mono text-[10px] uppercase tracking-wider border border-[#ddd0b4] rounded px-1 py-0.5 bg-[#fbf6eb]">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex h-full w-full justify-center gap-4">
        {/* Sidebar slot: logo + Layout button, visible only at >= 1500px */}
        {sidebar && (
          <div className="hidden min-w-[220px] max-w-[320px] flex-1 basis-0 items-center gap-2 self-stretch min-[1500px]:flex">
            {logo}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIntegrationsOpen(true)}
              className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
            >
              Connect
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPaymentOpen(true)}
              className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
            >
              Payment
            </Button>
            {layoutBtn}
          </div>
        )}

        {/* Main content row */}
        <div className="flex h-full w-full max-w-[1400px] items-center justify-between gap-4">
          {/* Left: logo + Connect + Layout button — hidden at >= 1500px when sidebar is active */}
          <div
            className={`flex items-center gap-2 ${sidebar ? "min-[1500px]:invisible" : ""}`}
          >
            {logo}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIntegrationsOpen(true)}
              className="hidden sm:flex text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
            >
              Connect
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPaymentOpen(true)}
              className="hidden sm:flex text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
            >
              Payment
            </Button>
            {layoutBtn}
          </div>

          {/* Right: editing controls or normal action buttons */}
          <div className="flex items-center gap-1 shrink-0">
            {layoutCtx?.isEditing ? (
              <>
                <select
                  value={layoutCtx.selectedColorSet ?? ""}
                  onChange={(e) =>
                    layoutCtx.setSelectedColorSet(e.target.value || null)
                  }
                  className="rounded-md border border-[#ddd0b4] bg-[#fbf6eb] px-2 py-1 text-[13px] text-[#5a5040] focus:outline-none hover:bg-[#ebe0ca]"
                >
                  <option value="">Color Set</option>
                  {COLOR_SETS.map((cs) => (
                    <option key={cs.name} value={cs.name}>
                      {cs.name}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={layoutCtx.randomizeColors}
                  className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
                >
                  Random
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={layoutCtx.saveLayout}
                  disabled={layoutCtx.isSaving}
                  className="text-[#5a5040] ring-1 ring-[#5a5040]/40 hover:bg-[#ebe0ca] hover:text-[#2e2719] hover:ring-[#2e2719]/40"
                >
                  {layoutCtx.isSaving ? "Saving…" : "Save"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={layoutCtx.resetLayout}
                  className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
                >
                  Reset
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={layoutCtx.cancelEditing}
                  className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setScheduleOpen(true)}
                  title="Schedule"
                  className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
                >
                  <CalendarDays className="h-4 w-4 shrink-0" />
                  <span className="hidden sm:inline">Schedule</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActivityOpen(true)}
                  title="Activity"
                  className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
                >
                  <ActivityIcon className="h-4 w-4 shrink-0" />
                  <span className="hidden sm:inline">Activity</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setNoticeOpen(true)}
                  title="Notice"
                  className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
                >
                  <Bell className="h-4 w-4 shrink-0" />
                  <span className="hidden sm:inline">Notice</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLogout}
                  className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
                >
                  Logout
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <ScheduleManagerModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
      />
      <ActivityModal
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
      />
      <ChatHistoryModal
        open={chatHistoryOpen}
        onClose={() => setChatHistoryOpen(false)}
      />
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
      <LongTermMemoryModal
        open={longMemOpen}
        onClose={() => setLongMemOpen(false)}
      />
      <MemosModal open={memosOpen} onClose={() => setMemosOpen(false)} />
      <NoticeModal open={noticeOpen} onClose={() => setNoticeOpen(false)} />
      <SubsidyModal open={subsidyOpen} onClose={() => setSubsidyOpen(false)} />
      <IntegrationsModal
        open={integrationsOpen}
        onClose={() => setIntegrationsOpen(false)}
        initialTab={integrationsInitialTab}
      />
      <PaymentModal open={paymentOpen} onClose={() => setPaymentOpen(false)} />
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
};
