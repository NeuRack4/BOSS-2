import { renderHook, act } from "@testing-library/react";
import { TourProvider, useTour } from "../TourContext";
import type { ReactNode } from "react";

const wrapper = ({ children }: { children: ReactNode }) => (
  <TourProvider>{children}</TourProvider>
);

describe("useTour", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts closed", () => {
    const { result } = renderHook(() => useTour(), { wrapper });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.currentStep).toBe(0);
  });

  it("start() opens tour at step 0", () => {
    const { result } = renderHook(() => useTour(), { wrapper });
    act(() => result.current.start());
    expect(result.current.isOpen).toBe(true);
    expect(result.current.currentStep).toBe(0);
  });

  it("next() advances step", () => {
    const { result } = renderHook(() => useTour(), { wrapper });
    act(() => result.current.start());
    act(() => result.current.next());
    expect(result.current.currentStep).toBe(1);
  });

  it("prev() decrements step, not below 0", () => {
    const { result } = renderHook(() => useTour(), { wrapper });
    act(() => result.current.start());
    act(() => result.current.prev());
    expect(result.current.currentStep).toBe(0);
    act(() => result.current.next());
    act(() => result.current.prev());
    expect(result.current.currentStep).toBe(0);
  });

  it("close() closes tour and sets localStorage", () => {
    const { result } = renderHook(() => useTour(), { wrapper });
    act(() => result.current.start());
    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
    expect(localStorage.getItem("boss_tour_done")).toBe("1");
  });

  it("next() on last step closes tour", () => {
    const { result } = renderHook(() => useTour(), { wrapper });
    act(() => result.current.start());
    // advance to last step (index 11)
    for (let i = 0; i < 11; i++) act(() => result.current.next());
    expect(result.current.currentStep).toBe(11);
    act(() => result.current.next());
    expect(result.current.isOpen).toBe(false);
  });
});
