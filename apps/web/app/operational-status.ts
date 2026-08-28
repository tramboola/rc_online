export type AvailableCar = {
  id: string;
  slug: string;
  name: string;
  batteryPercent: number | null;
};

export type OperationalStatus =
  | {
      state: "ready";
      cars: AvailableCar[];
      queueCount: number;
    }
  | {
      state: "unavailable";
      cars: [];
      queueCount: null;
    };

export interface OperationalStatusStore {
  listAvailableCars(at: Date): Promise<AvailableCar[]>;
  countActiveQueue(at: Date): Promise<number>;
}

export async function loadOperationalStatus(
  store: OperationalStatusStore,
  at: Date = new Date(),
): Promise<OperationalStatus> {
  try {
    const [cars, queueCount] = await Promise.all([
      store.listAvailableCars(at),
      store.countActiveQueue(at),
    ]);
    return { state: "ready", cars, queueCount };
  } catch {
    return { state: "unavailable", cars: [], queueCount: null };
  }
}
