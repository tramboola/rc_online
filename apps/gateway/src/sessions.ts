import type { GatewayClientMessage, GatewayServerMessage, IceServer } from "@rc/contracts";

type RelayMessage = Extract<
  GatewayClientMessage,
  { type: "signal.offer" | "signal.answer" | "signal.ice" | "session.end" }
>;

export interface GatewayPeer {
  send(message: GatewayServerMessage): void;
  close(code: number, reason: string): void;
}

export type BrowserSession = {
  sessionId: string;
  carId: string;
  userId: string;
  expiresAt: Date;
  iceServers: IceServer[];
};

type DeviceConnection = { deviceId: string; peer: GatewayPeer };
type ActiveSession = BrowserSession & { browser: GatewayPeer; device: GatewayPeer };

export class SessionRegistry {
  readonly #devicesByCar = new Map<string, DeviceConnection>();
  readonly #sessions = new Map<string, ActiveSession>();
  readonly #sessionsByCar = new Map<string, string>();

  attachDevice(carId: string, deviceId: string, peer: GatewayPeer): void {
    const prior = this.#devicesByCar.get(carId);
    if (prior && prior.peer !== peer) prior.peer.close(4409, "replaced by a new device connection");
    this.#devicesByCar.set(carId, { deviceId, peer });
  }

  detachDevice(carId: string, peer: GatewayPeer): string | null {
    const device = this.#devicesByCar.get(carId);
    if (!device || device.peer !== peer) return null;
    this.#devicesByCar.delete(carId);
    const sessionId = this.#sessionsByCar.get(carId);
    if (sessionId) this.end(sessionId, "device disconnected", false);
    return sessionId ?? null;
  }

  attachBrowser(session: BrowserSession, browser: GatewayPeer): boolean {
    if (this.#sessions.has(session.sessionId) || this.#sessionsByCar.has(session.carId)) return false;
    const device = this.#devicesByCar.get(session.carId);
    if (!device) return false;

    const active: ActiveSession = { ...session, browser, device: device.peer };
    this.#sessions.set(session.sessionId, active);
    this.#sessionsByCar.set(session.carId, session.sessionId);
    const start: GatewayServerMessage = {
      v: 1,
      type: "session.start",
      sessionId: session.sessionId,
      carId: session.carId,
      expiresAt: session.expiresAt.toISOString(),
      iceServers: session.iceServers
    };
    device.peer.send(start);
    browser.send(start);
    return true;
  }

  relayFromBrowser(sessionId: string, message: RelayMessage): boolean {
    const session = this.#sessions.get(sessionId);
    if (!session || message.sessionId !== sessionId || message.type === "signal.answer") return false;
    session.device.send(message);
    if (message.type === "session.end") this.end(sessionId, message.reason, false);
    return true;
  }

  relayFromDevice(carId: string, message: RelayMessage): boolean {
    const sessionId = this.#sessionsByCar.get(carId);
    const session = sessionId ? this.#sessions.get(sessionId) : undefined;
    if (!session || message.sessionId !== sessionId || message.type === "signal.offer") return false;
    session.browser.send(message);
    if (message.type === "session.end") this.end(sessionId, message.reason, false);
    return true;
  }

  detachBrowser(sessionId: string, reason: string): void {
    this.end(sessionId, reason, true);
  }

  hasSession(sessionId: string): boolean {
    return this.#sessions.has(sessionId);
  }

  sweep(now = new Date()): string[] {
    const expired: string[] = [];
    for (const [sessionId, session] of this.#sessions) {
      if (session.expiresAt.getTime() <= now.getTime()) {
        expired.push(sessionId);
        this.end(sessionId, "session expired", true);
      }
    }
    return expired;
  }

  private end(sessionId: string, reason: string, notifyDevice: boolean): void {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    this.#sessions.delete(sessionId);
    this.#sessionsByCar.delete(session.carId);
    const end: GatewayServerMessage = { v: 1, type: "session.end", sessionId, reason };
    if (notifyDevice) session.device.send(end);
    session.browser.send(end);
  }
}
