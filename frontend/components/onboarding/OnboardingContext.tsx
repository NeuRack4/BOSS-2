// frontend/components/onboarding/OnboardingContext.tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { ONBOARDING_STEPS } from "./steps";

type OnboardingContextValue = {
  isActive: boolean;
  currentStep: number;
  totalSteps: number;
  next: () => void;
  skip: () => void;
  startTour: () => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export const useOnboarding = (): OnboardingContextValue => {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding must be used inside <OnboardingProvider>");
  return ctx;
};

export const OnboardingProvider = ({ children }: { children: ReactNode }) => {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);

  // 유저 ID 구독
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // 첫 로그인 여부 확인 → 투어 자동 시작
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("onboarding_done")
      .eq("id", userId)
      .single()
      .then(({ data }) => {
        if (data && !(data as { onboarding_done: boolean }).onboarding_done) {
          setCurrentStep(0);
          setIsActive(true);
        }
      });
  }, [userId]);

  const finish = useCallback(async () => {
    setIsActive(false);
    if (!userId) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ onboarding_done: true })
      .eq("id", userId);
    if (error) console.error("[Onboarding] failed to save onboarding_done:", error);
    window.dispatchEvent(new CustomEvent("boss:onboarding-complete"));
  }, [userId]);

  const next = useCallback(() => {
    // currentStep is read directly from closure; dep array keeps it fresh,
    // so this check is always against the current step value.
    if (currentStep + 1 >= ONBOARDING_STEPS.length) {
      void finish();
    } else {
      setCurrentStep((s) => s + 1);
    }
  }, [currentStep, finish]);

  const skip = useCallback(() => {
    void finish();
  }, [finish]);

  const startTour = useCallback(() => {
    setCurrentStep(0);
    setIsActive(true);
  }, []);

  const value = useMemo(
    () => ({ isActive, currentStep, totalSteps: ONBOARDING_STEPS.length, next, skip, startTour }),
    [isActive, currentStep, next, skip, startTour],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
};
