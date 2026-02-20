import WebSocket from "ws";
import type { ChannelAcceptParams } from "./types.js";

type Frame = {
  type: string;
  id?: string;
  method?: string;
  params?: unknown;
  ok?: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
  event?: string;
  seq?: number;
};

/**
 * 反向 WebSocket 信号客户端。
 *
 * 连接 Ailo 网关，负责：
 *   - channel.register（注册通道提示词）
 *   - channel.accept（入站信号投递）
 *   - channel.data.*（持久化数据读写）
 *
 * 出站（AI → 平台）由 MCP stdio 工具处理，不经过此客户端。
 */
export class AiloClient {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private channel: string;
  private channelPrompt: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reqId = 0;

  constructor(url: string, token: string, channel: string, channelPrompt = "") {
    this.url = url;
    this.token = token;
    this.channel = channel;
    this.channelPrompt = channelPrompt;
  }

  private request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Ailo WebSocket not connected"));
        return;
      }
      const id = `${method}-${++this.reqId}`;
      const handler = (raw: Buffer) => {
        const frame = JSON.parse(raw.toString()) as Frame;
        if (frame.type === "res" && frame.id === id) {
          this.ws?.off("message", handler);
          if (frame.ok) {
            resolve((frame.payload as T) ?? ({} as T));
          } else {
            reject(new Error(frame.error?.message ?? `${method} failed`));
          }
        }
      };
      this.ws.on("message", handler);
      this.ws.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;

      ws.on("open", async () => {
        try {
          const id = `connect-${++this.reqId}`;
          ws.send(
            JSON.stringify({
              type: "req",
              id,
              method: "connect",
              params: {
                role: "channel",
                token: this.token,
                channel: this.channel,
                capabilities: ["text", "media"],
                direction: "bidirectional",
              },
            })
          );

          await new Promise<void>((res, rej) => {
            const onMsg = (raw: Buffer) => {
              const frame = JSON.parse(raw.toString()) as Frame;
              if (frame.type === "res" && frame.id === id) {
                ws.off("message", onMsg);
                if (frame.ok) {
                  res();
                } else {
                  rej(new Error(frame.error?.message ?? "connect failed"));
                }
              }
            };
            ws.on("message", onMsg);
          });

          await this.request("channel.register", {
            channel: this.channel,
            prompt: this.channelPrompt,
          });

          resolve();
        } catch (err) {
          reject(err);
        }
      });

      ws.on("close", () => {
        this.ws = null;
        this.scheduleReconnect(resolve);
      });

      ws.on("error", (err: Error) => {
        reject(err);
      });
    });
  }

  private scheduleReconnect(onReconnect?: () => void): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect()
        .then(() => onReconnect?.())
        .catch(() => this.scheduleReconnect(onReconnect));
    }, 3000);
  }

  sendMessage(params: ChannelAcceptParams): Promise<{ text?: string }> {
    const payload: Record<string, unknown> = {
      chatId: params.chatId,
      text: params.text,
      contextTags: params.contextTags,
      attachments: params.attachments ?? [],
    };
    if (params.coreForSenseContext != null && params.coreForSenseContext.length > 0) {
      payload.coreForSenseContext = params.coreForSenseContext;
    }
    return this.request<{ text?: string }>("channel.accept", payload);
  }

  // ---------------------------------------------------------------------------
  // channel.data.* — 通道持久化数据读写（存储于 SQLite channel_data 表）
  // ---------------------------------------------------------------------------

  async getData(key: string): Promise<string | null> {
    const res = await this.request<{ found: boolean; value?: string }>(
      "channel.data.get",
      { key }
    );
    return res.found ? (res.value ?? null) : null;
  }

  async getDataByPrefix(prefix: string): Promise<Record<string, string>> {
    const res = await this.request<{ items: Record<string, string> }>(
      "channel.data.get",
      { prefix }
    );
    return res.items ?? {};
  }

  async setData(key: string, value: string): Promise<void> {
    await this.request("channel.data.set", { key, value });
  }

  async setDataBatch(items: Record<string, string>): Promise<void> {
    await this.request("channel.data.set", { items });
  }

  async deleteData(key: string): Promise<void> {
    await this.request("channel.data.delete", { key });
  }

  async deleteDataByPrefix(prefix: string): Promise<void> {
    await this.request("channel.data.delete", { prefix });
  }

  close(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
