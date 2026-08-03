import { describe, expect, test } from "vitest";

import { getLeaderboardPresentation } from "./leaderboard-presentation";

describe("leaderboard presentation", () => {
  test("shows an honest three-row pre-launch state in mock mode", () => {
    const presentation = getLeaderboardPresentation(true);

    expect(presentation.seasonStatus).toEqual({
      title: "COMING SOON",
      subtitle: "DATES TBA",
    });
    expect(presentation.prize).toEqual({
      title: "—",
      subtitle: "PRIZE POOL TBA",
    });
    expect(presentation.emptyMessage).toBe("SEASON HASN'T STARTED YET");
    expect(presentation.rows).toHaveLength(3);
    expect(presentation.rows.every((row) => row.placeholder)).toBe(true);
    expect(presentation.rows.flatMap((row) => [
      row.rank,
      row.driver,
      row.lap,
      row.gap,
      row.date,
      row.status,
    ])).toEqual(Array(18).fill("—"));
    expect(presentation.personal).toEqual({
      rank: "—",
      bestLap: "—",
      validLaps: "—",
      weeklyChange: "—",
    });
    expect(presentation.personalRow).toBeNull();
  });

  test("retains the populated leaderboard outside mock mode", () => {
    const presentation = getLeaderboardPresentation(false);

    expect(presentation.rows[0]).toMatchObject({
      rank: "1",
      driver: "NIGHTSHIFT",
      lap: "00:42.817",
      placeholder: false,
    });
    expect(presentation.emptyMessage).toBeNull();
    expect(presentation.personalRow).toMatchObject({
      rank: "27",
      driver: "GRIDRUNNER",
      lap: "00:47.306",
    });
  });
});
