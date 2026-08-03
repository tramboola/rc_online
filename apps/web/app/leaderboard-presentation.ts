export type LeaderboardRow = {
  key: string;
  rank: string;
  driver: string;
  lap: string;
  gap: string;
  date: string;
  status: string;
  placeholder: boolean;
};

export type LeaderboardPresentation = {
  seasonStatus: { title: string; subtitle: string };
  prize: { title: string; subtitle: string };
  rows: readonly LeaderboardRow[];
  emptyMessage: string | null;
  personal: {
    rank: string;
    bestLap: string;
    validLaps: string;
    weeklyChange: string;
  };
  personalRow: LeaderboardRow | null;
};

const placeholderRows: readonly LeaderboardRow[] = Array.from(
  { length: 3 },
  (_, index) => ({
    key: `placeholder-${index + 1}`,
    rank: "—",
    driver: "—",
    lap: "—",
    gap: "—",
    date: "—",
    status: "—",
    placeholder: true,
  }),
);

const populatedEntries = [
  ["NIGHTSHIFT", "00:42.817", "—", "MAY 12 · 11:42", "CONFIRMED"],
  ["APEXGHOST", "00:43.162", "+00.345", "MAY 12 · 10:28", "CONFIRMED"],
  ["REDLINE", "00:43.498", "+00.681", "MAY 12 · 09:57", "CONFIRMED"],
  ["VORTEX", "00:43.901", "+01.084", "MAY 11 · 20:14", "CONFIRMED"],
  ["BLITZ", "00:44.112", "+01.295", "MAY 11 · 18:33", "CONFIRMED"],
  ["TURBOJAY", "00:44.388", "+01.571", "MAY 11 · 16:22", "CONFIRMED"],
  ["SLIPSTREAM", "00:44.776", "+01.959", "MAY 10 · 09:41", "PENDING REVIEW"],
  ["PHANTOM", "00:44.993", "+02.176", "MAY 10 · 07:05", "CONFIRMED"],
] as const;

const populatedRows: readonly LeaderboardRow[] = populatedEntries.map(
  ([driver, lap, gap, date, status], index) => ({
    key: driver,
    rank: String(index + 1),
    driver,
    lap,
    gap,
    date,
    status,
    placeholder: false,
  }),
);

const populatedPresentation: LeaderboardPresentation = {
  seasonStatus: { title: "LIVE SEASON", subtitle: "ENDS AUG 18" },
  prize: { title: "$1,000", subtitle: "TOTAL PRIZE POOL" },
  rows: populatedRows,
  emptyMessage: null,
  personal: {
    rank: "#27",
    bestLap: "00:47.306",
    validLaps: "32",
    weeklyChange: "-01.204",
  },
  personalRow: {
    key: "current-user",
    rank: "27",
    driver: "GRIDRUNNER",
    lap: "00:47.306",
    gap: "+04.489",
    date: "MAY 10 · 01:15",
    status: "CONFIRMED",
    placeholder: false,
  },
};

export function getLeaderboardPresentation(
  mockMode: boolean,
): LeaderboardPresentation {
  if (mockMode) {
    return {
      seasonStatus: { title: "COMING SOON", subtitle: "DATES TBA" },
      prize: { title: "—", subtitle: "PRIZE POOL TBA" },
      rows: placeholderRows,
      emptyMessage: "SEASON HASN'T STARTED YET",
      personal: {
        rank: "—",
        bestLap: "—",
        validLaps: "—",
        weeklyChange: "—",
      },
      personalRow: null,
    };
  }

  return populatedPresentation;
}
