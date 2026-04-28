"use client";

import { useRouter } from "next/navigation";
import { useChat } from "@/components/chat/ChatContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";

export const AdminFab = () => {
  const router = useRouter();
  const { userId } = useChat();
  const { isAdmin, loading } = useIsAdmin(userId);

  if (loading || !isAdmin) return null;

  return (
    <button
      onClick={() => router.push("/admin")}
      title="Admin 패널"
      style={{
        position: "fixed",
        bottom: "24px",
        right: "24px",
        width: "44px",
        height: "44px",
        borderRadius: "50%",
        background: "#2563eb",
        color: "white",
        border: "none",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "18px",
        boxShadow: "0 4px 16px rgba(37,99,235,0.45)",
        zIndex: 9999,
        transition: "transform .15s, box-shadow .15s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.08)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
      }}
    >
      ⚙
    </button>
  );
};
