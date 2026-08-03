import { describe, expect, test } from "vitest";

import {
  howItWorksRequirements,
  howItWorksSteps,
} from "./how-it-works-content";

describe("How It Works content", () => {
  test("describes the complete five-step customer journey", () => {
    expect(howItWorksSteps).toHaveLength(5);
    expect(howItWorksSteps.map((step) => step.id)).toEqual([
      "sign-in",
      "drive-time",
      "queue",
      "controls",
      "drive",
    ]);
  });

  test("makes the zero-wait queue path explicit", () => {
    const queue = howItWorksSteps.find((step) => step.id === "queue");

    expect(queue?.description).toMatch(/nobody is waiting/i);
    expect(queue?.description).toMatch(/immediately/i);
  });

  test("does not present safety as a page section", () => {
    expect(howItWorksRequirements.join(" ")).not.toMatch(/safety/i);
  });
});
