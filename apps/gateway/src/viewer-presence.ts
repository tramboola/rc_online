export interface ViewerSocket {
  readonly OPEN: number;
  readonly readyState: number;
  send(message: string): void;
}

export interface ViewerHeartbeatSocket {
  ping(): void;
  close(code: number, reason: string): void;
}

export function sweepViewerPings(sockets: Iterable<ViewerHeartbeatSocket>, alive: WeakSet<ViewerHeartbeatSocket>): void {
  for (const socket of sockets) {
    if (!alive.has(socket)) {
      socket.close(4408, "viewer pong timeout");
      continue;
    }
    alive.delete(socket);
    try {
      socket.ping();
    } catch {
      socket.close(4408, "viewer pong timeout");
    }
  }
}

export class ViewerPresence {
  readonly #sockets = new Set<ViewerSocket>();

  get count(): number {
    return this.#sockets.size;
  }

  attach(socket: ViewerSocket): () => void {
    if (socket.readyState !== socket.OPEN) return () => undefined;
    this.#sockets.add(socket);
    this.#broadcast();

    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      if (!this.#sockets.delete(socket)) return;
      this.#broadcast();
    };
  }

  #broadcast(): void {
    for (const socket of this.#sockets) {
      if (socket.readyState !== socket.OPEN) this.#sockets.delete(socket);
    }
    const message = JSON.stringify({ v: 1, type: "viewer.count", count: this.count });
    let removed = false;
    for (const socket of this.#sockets) {
      try {
        socket.send(message);
      } catch {
        this.#sockets.delete(socket);
        removed = true;
      }
    }
    if (removed) this.#broadcast();
  }
}
