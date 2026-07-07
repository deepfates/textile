import {
  NetworkAdapter,
  cbor,
  type Message,
  type PeerId,
  type PeerMetadata,
} from "@automerge/automerge-repo/slim";
import { WebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
import WebSocket from "isomorphic-ws";

const PROTOCOL_V1 = "1";
const swallowSocketAbortError = () => {};

type TimeoutId = ReturnType<typeof setTimeout>;
type IntervalId = ReturnType<typeof setInterval>;
type DestroyableSocket = { destroy: () => void; destroyed?: boolean };
type WebSocketInternals = {
  _req?: { abort?: () => void; socket?: DestroyableSocket };
  _socket?: DestroyableSocket;
};

export type SyncMode = "best-effort" | "required";

export type SyncStatus =
  | { state: "connecting"; url: string }
  | { state: "connected"; url: string; peerId: PeerId }
  | { state: "disconnected"; url: string; retryInMs?: number }
  | { state: "failed"; url: string; error: Error; recoverable: boolean };

export type SyncAuth =
  | { type: "bearer"; token: string }
  | { type: "api-key"; token: string; header?: string };

export interface WebSocketSyncOptions {
  kind?: "websocket";
  url: string;
  retryInterval?: number;
  adapter?: "auto" | "native" | "resilient";
  mode?: SyncMode;
  headers?: Record<string, string>;
  auth?: SyncAuth;
  onStatus?: (status: SyncStatus) => void;
  onError?: (error: Error) => void;
}

type JoinMessage = {
  type: "join";
  senderId: PeerId;
  peerMetadata: PeerMetadata;
  supportedProtocolVersions: string[];
};

type PeerMessage = {
  type: "peer";
  senderId: PeerId;
  peerMetadata: PeerMetadata;
  selectedProtocolVersion: string;
  targetId: PeerId;
};

type ErrorMessage = {
  type: "error";
  senderId: PeerId;
  message: string;
  targetId: PeerId;
};

type FromClientMessage = JoinMessage | Message;
type FromServerMessage = PeerMessage | ErrorMessage | Message;

export function createWebSocketSyncAdapter(options: WebSocketSyncOptions) {
  if (shouldUseNativeAdapter(options)) {
    return new WebSocketClientAdapter(options.url, options.retryInterval);
  }
  return new ResilientWebSocketClientAdapter(options);
}

function shouldUseNativeAdapter(options: WebSocketSyncOptions) {
  if (options.adapter === "resilient") return false;
  if (options.adapter === "native") {
    if (options.auth || hasHeaders(options.headers)) {
      throw new Error("The native Automerge websocket adapter does not support auth headers");
    }
    return true;
  }

  return (
    !options.auth &&
    !hasHeaders(options.headers) &&
    !options.onStatus &&
    !options.onError &&
    options.mode !== "required"
  );
}

class ResilientWebSocketClientAdapter extends NetworkAdapter {
  private socket?: WebSocket;
  private ready = false;
  private readyResolver?: () => void;
  private readyPromise: Promise<void> = new Promise((resolve) => {
    this.readyResolver = resolve;
  });
  private retryIntervalId?: IntervalId;
  private retryTimeoutId?: TimeoutId;
  private readonly retryInterval: number;
  private readonly mode: SyncMode;
  private abandonedHandshakeRetryAt = 0;

  remotePeerId?: PeerId;

  constructor(private readonly options: WebSocketSyncOptions) {
    super();
    this.retryInterval = options.retryInterval ?? 5_000;
    this.mode = options.mode ?? "best-effort";
  }

  isReady() {
    return this.ready;
  }

  whenReady() {
    return this.readyPromise;
  }

  connect(peerId: PeerId, peerMetadata?: PeerMetadata) {
    if (Date.now() < this.abandonedHandshakeRetryAt) return;

    if (!this.socket || !this.peerId) {
      this.peerId = peerId;
      this.peerMetadata = peerMetadata ?? {};
    } else if (peerId !== this.peerId) {
      this.reportError(new Error("Cannot reconnect websocket with a new peer id"), false);
      return;
    } else {
      const previousSocket = this.socket;
      this.closeSocket(previousSocket, { reportConnectingFailure: true });
      if (previousSocket.readyState !== WebSocket.CLOSED) {
        return;
      }
    }

    if (!this.retryIntervalId && this.retryInterval > 0) {
      this.retryIntervalId = setInterval(() => {
        this.connect(peerId, peerMetadata);
      }, this.retryInterval);
    }

    this.options.onStatus?.({ state: "connecting", url: this.options.url });
    this.socket = new WebSocket(this.options.url, {
      headers: syncHeaders(this.options),
    });
    this.socket.binaryType = "arraybuffer";
    this.socket.addEventListener("open", this.onOpen);
    this.socket.addEventListener("close", this.onClose);
    this.socket.addEventListener("message", this.onMessage);
    this.socket.addEventListener("error", this.onSocketError);

    setTimeout(() => this.forceReady(), 1_000);
    this.join();
  }

  disconnect() {
    if (this.retryIntervalId) clearInterval(this.retryIntervalId);
    if (this.retryTimeoutId) clearTimeout(this.retryTimeoutId);
    this.retryIntervalId = undefined;
    this.retryTimeoutId = undefined;

    if (this.socket) {
      this.closeSocket(this.socket);
    }
    if (this.remotePeerId) {
      this.emit("peer-disconnected", { peerId: this.remotePeerId });
      this.remotePeerId = undefined;
    }
    this.socket = undefined;
  }

  send(message: FromClientMessage) {
    if ("data" in message && message.data?.byteLength === 0) {
      this.reportError(new Error("Tried to send a zero-length sync message"), false);
      return;
    }
    if (!this.peerId || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      if (this.mode === "required") {
        this.reportError(new Error("Websocket not ready"), true);
      }
      return;
    }

    try {
      this.socket.send(toArrayBuffer(cbor.encode(message)));
    } catch (error) {
      this.reportError(toError(error), true);
    }
  }

  private onOpen = () => {
    this.clearRetryInterval();
    this.abandonedHandshakeRetryAt = 0;
    this.join();
  };

  private onClose = () => {
    if (this.remotePeerId) {
      this.emit("peer-disconnected", { peerId: this.remotePeerId });
      this.remotePeerId = undefined;
    }

    const retryInMs = this.retryInterval > 0 ? this.retryInterval : undefined;
    this.options.onStatus?.({
      state: "disconnected",
      url: this.options.url,
      retryInMs,
    });

    if (retryInMs && !this.retryTimeoutId) {
      this.retryTimeoutId = setTimeout(() => {
        this.retryTimeoutId = undefined;
        if (this.peerId) this.connect(this.peerId, this.peerMetadata);
      }, retryInMs);
    }
  };

  private onMessage = (event: WebSocket.MessageEvent) => {
    this.receiveMessage(event.data as Uint8Array);
  };

  private onSocketError = (event: Event | WebSocket.ErrorEvent) => {
    this.reportError("error" in event ? toError(event.error) : new Error("WebSocket error"), true);
  };

  private join() {
    if (!this.peerId || !this.socket) return;
    if (this.socket.readyState === WebSocket.OPEN) {
      this.send({
        type: "join",
        senderId: this.peerId,
        peerMetadata: this.peerMetadata ?? {},
        supportedProtocolVersions: [PROTOCOL_V1],
      });
    }
  }

  private receiveMessage(messageBytes: Uint8Array) {
    let message: FromServerMessage;
    try {
      message = cbor.decode(new Uint8Array(messageBytes));
    } catch (error) {
      this.reportError(toError(error), true);
      return;
    }

    if (messageBytes.byteLength === 0) {
      this.reportError(new Error("Received a zero-length sync message"), true);
      return;
    }

    if (isPeerMessage(message)) {
      this.forceReady();
      this.remotePeerId = message.senderId;
      this.clearRetryInterval();
      this.options.onStatus?.({
        state: "connected",
        url: this.options.url,
        peerId: message.senderId,
      });
      this.emit("peer-candidate", {
        peerId: message.senderId,
        peerMetadata: message.peerMetadata,
      });
    } else if (isErrorMessage(message)) {
      this.reportError(new Error(message.message), true);
    } else {
      this.emit("message", message);
    }
  }

  private forceReady() {
    if (!this.ready) {
      this.ready = true;
      this.readyResolver?.();
    }
  }

  private clearRetryInterval() {
    if (this.retryIntervalId) clearInterval(this.retryIntervalId);
    this.retryIntervalId = undefined;
  }

  private reportError(error: Error, recoverable: boolean) {
    this.options.onError?.(error);
    this.options.onStatus?.({
      state: "failed",
      url: this.options.url,
      error,
      recoverable,
    });
    if (this.mode === "required" && !recoverable) {
      throw error;
    }
  }

  private removeSocketListeners(socket: WebSocket) {
    socket.removeEventListener("open", this.onOpen);
    socket.removeEventListener("close", this.onClose);
    socket.removeEventListener("message", this.onMessage);
    socket.removeEventListener("error", this.onSocketError);
  }

  private closeSocket(
    socket: WebSocket,
    options: { reportConnectingFailure?: boolean } = {},
  ) {
    this.removeSocketListeners(socket);
    socket.addEventListener("error", swallowSocketAbortError);
    if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
      return;
    }

    if (socket.readyState === WebSocket.CONNECTING) {
      if (options.reportConnectingFailure) {
        this.reportError(new Error("WebSocket handshake timed out"), true);
      }
      this.abandonedHandshakeRetryAt = Date.now() + Math.max(this.retryInterval, 5_000);
      this.destroySocketTransport(socket);
      socket.terminate();
      return;
    }

    socket.close();
    const timeout = setTimeout(() => {
      if (socket.readyState !== WebSocket.CLOSED) {
        this.destroySocketTransport(socket);
        socket.terminate();
      }
    }, 1_000);
    timeout.unref?.();
  }

  private destroySocketTransport(socket: WebSocket) {
    const internals = socket as WebSocket & WebSocketInternals;
    internals._req?.abort?.();
    if (internals._req?.socket && !internals._req.socket.destroyed) {
      internals._req.socket.destroy();
    }
    if (internals._socket && !internals._socket.destroyed) {
      internals._socket.destroy();
    }
  }
}

function syncHeaders(options: WebSocketSyncOptions) {
  const headers = { ...options.headers };
  if (options.auth?.type === "bearer") {
    headers.authorization = `Bearer ${options.auth.token}`;
  } else if (options.auth?.type === "api-key") {
    headers[options.auth.header ?? "x-api-key"] = options.auth.token;
  }
  return headers;
}

function hasHeaders(headers: Record<string, string> | undefined) {
  return Boolean(headers && Object.keys(headers).length > 0);
}

function isPeerMessage(message: FromServerMessage): message is PeerMessage {
  return message.type === "peer";
}

function isErrorMessage(message: FromServerMessage): message is ErrorMessage {
  return message.type === "error";
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}
