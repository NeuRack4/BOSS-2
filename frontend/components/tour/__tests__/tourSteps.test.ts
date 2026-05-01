import { TOUR_STEPS } from "../tourSteps";

describe("TOUR_STEPS", () => {
  it("has exactly 12 steps", () => {
    expect(TOUR_STEPS).toHaveLength(12);
  });

  it("each step has required fields", () => {
    for (const step of TOUR_STEPS) {
      expect(step.id).toBeTruthy();
      expect(step.title).toBeTruthy();
      expect(step.iconName).toBeTruthy();
      expect(step.description).toBeTruthy();
    }
  });

  it("step ids are unique", () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
