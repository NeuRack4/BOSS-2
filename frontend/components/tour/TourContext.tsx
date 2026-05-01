"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { TOUR_STEPS } from "./tourSteps";

type TourContextValue = {
  isOpen: boolean;
  currentStep: number;
  start: () => void;
  next: () => void;
  prev: () => void;
  close: () => void;
};

const TourContext = createContext<TourContextValue | null>(null);

export const TourProvider = ({ children }: { children: ReactNode }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  const start = useCallback(() => {
    setCurrentStep(0);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    localStorage.setItem("boss_tour_done", "1");
    window.dispatchEvent(new CustomEvent("boss:tour-complete"));
  }, []);

  const next = useCallback(() => {
    if (currentStep >= TOUR_STEPS.length - 1) {
      setIsOpen(false);
      setCurrentStep(0);
      localStorage.setItem("boss_tour_done", "1");
      window.dispatchEvent(new CustomEvent("boss:tour-complete"));
    } else {
      setCurrentStep((s) => s + 1);
    }
  }, [currentStep]);

  const prev = useCallback(() => {
    setCurrentStep((s) => Math.max(0, s - 1));
  }, []);

  return (
    <TourContext.Provider value={{ isOpen, currentStep, start, next, prev, close }}>
      {children}
    </TourContext.Provider>
  );
};

export const useTour = (): TourContextValue => {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used inside TourProvider");
  return ctx;
};
