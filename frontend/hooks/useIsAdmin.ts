"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export const useIsAdmin = (userId: string | null) => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    const check = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", userId)
        .single();
      setIsAdmin(data?.is_admin === true);
      setLoading(false);
    };

    void check();
  }, [userId]);

  return { isAdmin, loading };
};
