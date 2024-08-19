import {
  NetworkAdapter,
  type PeerId,
  type PeerMetadata,
} from "@automerge/automerge-repo";
import type { ServerWebSocket, WebSocketHandler } from "bun";
import type {
  FromClientMessage,
  FromServerMessage,
  ProtocolVersion,
} from "@automerge/automerge-repo-network-websocket";
import { ProtocolV1 } from "@automerge/automerge-repo-network-websocket/src/protocolVersion.ts";
import { assert } from "@automerge/automerge-repo-network-websocket/src/assert.ts";
import { toArrayBuffer } from "@automerge/automerge-repo-network-websocket/src/toArrayBuffer.ts";
import { decode, encode } from "@automerge/automerge-repo/helpers/cbor.js";
import {
  isJoinMessage,
  isLeaveMessage,
} from "@automerge/automerge-repo-network-websocket/src/messages.ts";

export class BunWSServerAdapter
  extends NetworkAdapter
  implements WebSocketHandler
{
  private sockets: Record<PeerId, WebSocketWithIsAlive | undefined> = {};
  private keepAliveInterval: number = 5000;
  private keepAliveId: Timer | undefined;

  connect = (peerId: PeerId, peerMetadata?: PeerMetadata): void => {
    this.peerId = peerId;
    this.peerMetadata = peerMetadata;
    this.keepAliveId = setInterval(() => {
      // Terminate connections to lost clients
      const clients = Object.values(this.sockets) as WebSocketWithIsAlive[];
      clients.forEach((socket) => {
        if (socket.isAlive) {
          // Mark all clients as potentially dead until we hear from them
          socket.isAlive = false;
          socket.ping();
        } else {
          this.#terminate(socket);
        }
      });
    }, this.keepAliveInterval);
  };

  disconnect = (): void => {
    clearInterval(this.keepAliveId);
    Object.values(this.sockets).forEach((socket) => {
      if (!socket) return;
      this.#terminate(socket);
    });
  };

  send = (message: FromServerMessage) => {
    assert("targetId" in message && message.targetId !== undefined);
    if ("data" in message && message.data?.byteLength === 0)
      throw new Error("Tried to send a zero-length message");

    const senderId = this.peerId;
    assert(senderId, "No peerId set for the websocket server network adapter.");

    const socket = this.sockets[message.targetId];

    if (!socket) {
      log(`Tried to send to disconnected peer: ${message.targetId}`);
      return;
    }

    const encoded = encode(message);
    const arrayBuf = toArrayBuffer(encoded);

    socket.send(arrayBuf);
  };

  receiveMessage = (messageBytes: Uint8Array, socket: ServerWebSocket) => {
    const message: FromClientMessage = decode(messageBytes);

    const { type, senderId } = message;

    const myPeerId = this.peerId;
    assert(myPeerId);

    const documentId = "documentId" in message ? "@" + message.documentId : "";
    const { byteLength } = messageBytes;
    log(
      `[${senderId}->${myPeerId}${documentId}] ${type} | ${byteLength} bytes`,
    );

    if (isJoinMessage(message)) {
      const { peerMetadata, supportedProtocolVersions } = message;
      const existingSocket = this.sockets[senderId];
      if (existingSocket) {
        if (existingSocket.readyState === WebSocket.OPEN) {
          existingSocket.close();
        }
        this.emit("peer-disconnected", { peerId: senderId });
      }

      // Let the repo know that we have a new connection.
      this.emit("peer-candidate", { peerId: senderId, peerMetadata });
      this.sockets[senderId] = socket;

      const selectedProtocolVersion = selectProtocol(supportedProtocolVersions);
      if (selectedProtocolVersion === null) {
        this.send({
          type: "error",
          senderId: this.peerId!,
          message: "unsupported protocol version",
          targetId: senderId,
        });
        this.sockets[senderId].close();
        delete this.sockets[senderId];
      } else {
        this.send({
          type: "peer",
          senderId: this.peerId!,
          peerMetadata: this.peerMetadata!,
          selectedProtocolVersion: ProtocolV1,
          targetId: senderId,
        });
      }
    } else if (isLeaveMessage(message)) {
      const { senderId } = message;
      const socket = this.sockets[senderId];
      /* c8 ignore next */
      if (!socket) return;
      this.#terminate(socket);
    } else {
      this.emit("message", message);
    }
  };

  #terminate = (socket: WebSocketWithIsAlive) => {
    this.#removeSocket(socket);
    socket.terminate();
  };

  #removeSocket = (socket: ServerWebSocket) => {
    const peerId = this.#peerIdBySocket(socket);
    if (!peerId) return;
    this.emit("peer-disconnected", { peerId });
    delete this.sockets[peerId as PeerId];
  };

  #peerIdBySocket = (socket: ServerWebSocket) => {
    const isThisSocket = (peerId: string) =>
      this.sockets[peerId as PeerId] === socket;
    const result = Object.keys(this.sockets).find(isThisSocket) as PeerId;
    return result ?? null;
  };

  // WebSocketHandler

  open = (ws: WebSocketWithIsAlive): void | Promise<void> => {
    ws.isAlive = true;
    this.emit("ready", { network: this });
  };

  close = (
    ws: WebSocketWithIsAlive,
    code: number,
    reason: string,
  ): void | Promise<void> => {
    ws.isAlive = false;
    this.#removeSocket(ws);
  };

  pong = (ws: WebSocketWithIsAlive, data: Buffer): void | Promise<void> => {
    ws.isAlive = true;
  };

  message = (
    ws: WebSocketWithIsAlive,
    message: string | Buffer,
  ): void | Promise<void> => {
    ws.isAlive = true;
    if (typeof message === "string") return;
    this.receiveMessage(message, ws);
  };
}

const selectProtocol = (versions?: ProtocolVersion[]) => {
  if (versions === undefined) return ProtocolV1;
  if (versions.includes(ProtocolV1)) return ProtocolV1;
  return null;
};

interface WebSocketWithIsAlive extends ServerWebSocket {
  isAlive?: boolean;
}

function log(...data: any[]) {
  if (process.env.NODE_ENV === "production") return;
  console.log(...data);
}
