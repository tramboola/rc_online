import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { RideSessionClock, SteeringTrimControl } from "./real-ride-screen";

describe("real ride session controls", () => {
  it("shows the server-derived remaining session time", () => {
    const markup = renderToStaticMarkup(<RideSessionClock remainingSeconds={64} />);

    expect(markup).toContain("SESSION");
    expect(markup).toContain("01:04");
  });

  it("renders a wide bounded steering-neutral adjustment", () => {
    const markup = renderToStaticMarkup(
      <SteeringTrimControl
        disabled={false}
        onChange={vi.fn()}
        onReset={vi.fn()}
        saveStatus="saved"
        value={-12}
      />,
    );

    expect(markup).toContain("STEERING NEUTRAL");
    expect(markup).toContain("-12%");
    expect(markup).toContain("SAVED");
    expect(markup).toContain('min="-20"');
    expect(markup).toContain('max="20"');
  });
});
