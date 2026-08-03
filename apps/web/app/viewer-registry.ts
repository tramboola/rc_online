type Clock = () => number;

export class ViewerRegistry {
  private readonly viewers = new Map<string, number>();

  constructor(
    private readonly ttlMs = 45_000,
    private readonly now: Clock = Date.now,
    private readonly maxEntries = 10_000,
  ) {}

  heartbeat(viewerId: string): number {
    const timestamp = this.now();
    this.prune(timestamp);

    if (!this.viewers.has(viewerId) && this.viewers.size >= this.maxEntries) {
      this.evictOldest();
    }

    this.viewers.set(viewerId, timestamp);
    return this.viewers.size;
  }

  count(): number {
    this.prune(this.now());
    return this.viewers.size;
  }

  private prune(timestamp: number): void {
    const cutoff = timestamp - this.ttlMs;
    for (const [viewerId, lastSeenAt] of this.viewers) {
      if (lastSeenAt < cutoff) {
        this.viewers.delete(viewerId);
      }
    }
  }

  private evictOldest(): void {
    let oldestViewerId: string | undefined;
    let oldestTimestamp = Number.POSITIVE_INFINITY;

    for (const [viewerId, lastSeenAt] of this.viewers) {
      if (lastSeenAt < oldestTimestamp) {
        oldestTimestamp = lastSeenAt;
        oldestViewerId = viewerId;
      }
    }

    if (oldestViewerId) {
      this.viewers.delete(oldestViewerId);
    }
  }
}

const globalForViewerRegistry = globalThis as typeof globalThis & {
  rcmaniaViewerRegistry?: ViewerRegistry;
};

export const viewerRegistry =
  globalForViewerRegistry.rcmaniaViewerRegistry ?? new ViewerRegistry();

globalForViewerRegistry.rcmaniaViewerRegistry = viewerRegistry;
