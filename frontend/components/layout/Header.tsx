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
  LayoutGrid,
  LogOut,
  Search,
} from "lucide-react";
import { ScheduleManagerModal } from "@/components/layout/ScheduleManagerModal";
import { ActivityModal } from "@/components/layout/ActivityModal";
import { SearchPalette } from "@/components/search/SearchPalette";

export const Header = () => {
  const router = useRouter();
  const supabase = createClient();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="h-12 border-b border-[#ddd0b4] bg-[#fbf6eb] text-[#2e2719] flex items-center px-4 shrink-0 z-50 gap-4">
      <Link
        href="/dashboard"
        aria-label="BOSS 대쉬보드"
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

      <div className="flex-1 flex justify-center">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-2 w-full max-w-[420px] rounded-md border border-[#ddd0b4] bg-[#ebe0ca]/40 px-3 py-1.5 text-[12px] text-[#8c7e66] hover:bg-[#ebe0ca] hover:text-[#5a5040] transition-colors"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">노드·메모 검색…</span>
          <kbd className="font-mono text-[10px] uppercase tracking-wider border border-[#ddd0b4] rounded px-1 py-0.5 bg-[#fbf6eb]">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("boss:reset-layout"))
          }
          title="노드 정렬 초기화"
          className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
        >
          <LayoutGrid className="h-4 w-4 mr-1.5" />
          정렬
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setScheduleOpen(true)}
          title="일정 관리"
          className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
        >
          <CalendarClock className="h-4 w-4 mr-1.5" />
          일정 관리
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActivityOpen(true)}
          title="활동이력"
          className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
        >
          <History className="h-4 w-4 mr-1.5" />
          활동이력
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
        >
          <LogOut className="h-4 w-4 mr-1.5" />
          로그아웃
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
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
};
