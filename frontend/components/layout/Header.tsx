"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { History, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

export const Header = () => {
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="h-12 border-b border-zinc-800 bg-zinc-950 text-zinc-100 flex items-center justify-between px-4 shrink-0 z-50">
      <span className="text-sm font-semibold tracking-tight text-zinc-100">
        BOSS v0.1.0
      </span>
      <div className="flex items-center gap-1">
        <Link
          href="/activity"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100",
          )}
        >
          <History className="h-4 w-4 mr-1.5" />
          활동이력
        </Link>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <LogOut className="h-4 w-4 mr-1.5" />
          로그아웃
        </Button>
      </div>
    </header>
  );
};
