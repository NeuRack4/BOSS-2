"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  CalendarClock,
  History,
  LogOut,
  MessageSquare,
  Moon,
  Search,
  Send,
  Sun,
} from "lucide-react";
import { ScheduleManagerModal } from "@/components/layout/ScheduleManagerModal";
import { ActivityModal } from "@/components/layout/ActivityModal";
import { ChatHistoryModal } from "@/components/layout/ChatHistoryModal";
import { ProfileModal } from "@/components/layout/ProfileModal";
import { LongTermMemoryModal } from "@/components/layout/LongTermMemoryModal";
import { MemosModal } from "@/components/layout/MemosModal";
import { CommentManagerModal } from "@/components/layout/CommentManagerModal";
import { DMCampaignModal } from "@/components/layout/DMCampaignModal";
import { SearchPalette } from "@/components/search/SearchPalette";

export const Header = () => {
  const router = useRouter();
  const supabase = createClient();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [longMemOpen, setLongMemOpen] = useState(false);
  const [memosOpen, setMemosOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [dmCampaignOpen, setDmCampaignOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [darkBg, setDarkBg] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("boss2:bg-dark");
    if (stored === "true") {
      setDarkBg(true);
      document.documentElement.setAttribute("data-bg", "dark");
    }
  }, []);

  const toggleBg = () => {
    const next = !darkBg;
    setDarkBg(next);
    if (next) document.documentElement.setAttribute("data-bg", "dark");
    else document.documentElement.removeAttribute("data-bg");
    localStorage.setItem("boss2:bg-dark", String(next));
  };

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
    const onOpenComment = () => setCommentOpen(true);
    const onOpenDmCampaign = () => setDmCampaignOpen(true);
    window.addEventListener("boss:open-schedule-modal", onOpenSchedule);
    window.addEventListener("boss:open-activity-modal", onOpenActivity);
    window.addEventListener("boss:open-chat-history-modal", onOpenChatHistory);
    window.addEventListener("boss:open-profile-modal", onOpenProfile);
    window.addEventListener("boss:open-longmem-modal", onOpenLongMem);
    window.addEventListener("boss:open-memos-modal", onOpenMemos);
    window.addEventListener("boss:open-comment-modal", onOpenComment);
    window.addEventListener("boss:open-dm-campaign-modal", onOpenDmCampaign);
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
      window.removeEventListener("boss:open-comment-modal", onOpenComment);
      window.removeEventListener("boss:open-dm-campaign-modal", onOpenDmCampaign);
    };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="relative h-12 border-b border-[#ddd0b4] bg-[#fbf6eb] text-[#2e2719] flex items-center justify-between px-4 shrink-0 z-50 gap-4">
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

      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="pointer-events-auto flex items-center gap-2 w-[420px] max-w-[60vw] rounded-md border border-[#ddd0b4] bg-[#ebe0ca]/40 px-3 py-1.5 text-[12px] text-[#8c7e66] hover:bg-[#ebe0ca] hover:text-[#5a5040] transition-colors"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="font-mono text-[10px] uppercase tracking-wider border border-[#ddd0b4] rounded px-1 py-0.5 bg-[#fbf6eb]">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setScheduleOpen(true)}
          title="Schedule"
          className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
        >
          <CalendarClock className="h-4 w-4 mr-1.5" />
          Schedule
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActivityOpen(true)}
          title="Activity"
          className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
        >
          <History className="h-4 w-4 mr-1.5" />
          Activity
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCommentOpen(true)}
          title="Comments"
          className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
        >
          <MessageSquare className="h-4 w-4 mr-1.5" />
          Comments
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDmCampaignOpen(true)}
          title="DM Campaigns"
          className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
        >
          <Send className="h-4 w-4 mr-1.5" />
          DM
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleBg}
          title={darkBg ? "Switch to light" : "Switch to dark"}
          className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
        >
          {darkBg ? (
            <Sun className="h-4 w-4 mr-1.5" />
          ) : (
            <Moon className="h-4 w-4 mr-1.5" />
          )}
          {darkBg ? "Light" : "Dark"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
        >
          <LogOut className="h-4 w-4 mr-1.5" />
          Logout
        </Button>
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
      <CommentManagerModal
        open={commentOpen}
        onClose={() => setCommentOpen(false)}
      />
      <DMCampaignModal
        open={dmCampaignOpen}
        onClose={() => setDmCampaignOpen(false)}
      />
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
};
