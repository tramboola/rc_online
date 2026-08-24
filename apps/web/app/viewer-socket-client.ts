export type ViewerSocketStatus = "connecting" | "live" | "unavailable";

type ViewerSocket = Pick<WebSocket, "close"> & {
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
};

export type ViewerSocketOptions = {
  createSocket?: (url: string) => ViewerSocket;
  location?: Pick<Location, "host" | "protocol">;
  onCount: (count: number) => void;
  onStatus: (status: ViewerSocketStatus) => void;
};

const reconnectDelaysMs = [1_000, 2_000, 4_000, 8_000, 15_000];

function isViewerCountMessage(value: unknown): value is { v: 1; type: "viewer.count"; count: number } {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    message.v === 1 &&
    message.type === "viewer.count" &&
    typeof message.count === "number" &&
    Number.isInteger(message.count) &&
    message.count >= 0
  );
}

function getViewerSocketUrl(location: Pick<Location, "host" | "protocol">): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/gateway/v1/viewers`;
}

export function connectViewerSocket(options: ViewerSocketOptions): () => void {
  const location = options.location ?? window.location;
  const createSocket = options.createSocket ?? ((url: string): ViewerSocket => (
    new WebSocket(url) as unknown as ViewerSocket
  ));
  let closed = false;
  let retryIndex = 0;
  let retryTimeout: ReturnType<typeof setTimeout> | null = null;
  let currentSocket: ViewerSocket | null = null;
  let socketToClose: ViewerSocket | null = null;

  function scheduleReconnect() {
    if (closed || retryTimeout !== null) return;
    const delay = reconnectDelaysMs[Math.min(retryIndex, reconnectDelaysMs.length - 1)];
    retryIndex += 1;
    retryTimeout = setTimeout(() => {
      retryTimeout = null;
      connect();
    }, delay);
  }

  function connect() {
    if (closed) return;
    options.onStatus("connecting");
    try {
      const socket = createSocket(getViewerSocketUrl(location));
      currentSocket = socket;
      socketToClose = socket;
      socket.onmessage = (event) => {
        if (closed || socket !== currentSocket) return;
        try {
          const message: unknown = JSON.parse(String(event.data));
          if (!isViewerCountMessage(message)) return;
          retryIndex = 0;
          options.onCount(message.count);
          options.onStatus("live");
        } catch {
          // Ignore malformed gateway messages.
        }
      };
      socket.onerror = () => {
        if (closed || socket !== currentSocket) return;
        options.onStatus("unavailable");
      };
      socket.onclose = () => {
        if (closed || socket !== currentSocket) return;
        currentSocket = null;
        options.onStatus("unavailable");
        scheduleReconnect();
      };
    } catch {
      options.onStatus("unavailable");
      scheduleReconnect();
    }
  }

  connect();

  return () => {
    if (closed) return;
    closed = true;
    if (retryTimeout !== null) clearTimeout(retryTimeout);
    socketToClose?.close();
    currentSocket = null;
  };
}
