import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AiloClient } from "./ailo-client.js";
import type { BridgeHandler, BridgeMessage } from "./types.js";

/**
 * MCP 通道启动配置
 *
 * AIDO_WS_URL、AIDO_TOKEN、AIDO_MCP_NAME 由主程序在拉起 MCP 时注入，SDK 自动读取。
 * 通道开发者只需提供 handler、mcpServer、buildChannelPrompt 等业务配置。
 */
export interface McpChannelConfig {
  /** MCP 名称（如 channel:feishu），connect 时与 token 一起发送供服务端校验。不传则从 AIDO_MCP_NAME / AILO_MCP_NAME 读取 */
  channelName?: string;
  /** 平台 Handler 实例（需实现 BridgeHandler 接口） */
  handler: BridgeHandler;
  /** Ailo WebSocket 网关地址。不传则从 AIDO_WS_URL / AILO_WS_URL 读取 */
  ailoWsUrl?: string;
  /** Ailo 网关认证 Token。不传则从 AIDO_TOKEN / AILO_TOKEN 读取 */
  ailoToken?: string;
  /**
   * 构建通道静态提示词（connect 时注册）。
   * 连接时调用一次，注册该通道的特殊规则。
   */
  buildChannelPrompt?: () => string;
  /** 预配置的 MCP Server 实例（已注册好工具） */
  mcpServer: McpServer;
}

export function defaultBuildChannelPrompt(): string {
  return `用户 @你 时会在消息中标注。`;
}

/**
 * 启动 MCP Server（纯工具 / 单向发通道用）
 *
 * 本 SDK 作为脚手架：只需创建 MCP Server、注册工具，调用此函数即可启动。
 * stdout 被 MCP stdio 占用，日志自动重定向到 stderr。
 */
export function runMcp(mcpServer: McpServer): void {
  console.log = (...args: unknown[]) => console.error(...args);
  const transport = new StdioServerTransport();
  mcpServer.connect(transport).then(() => {
    console.log("[mcp] MCP stdio server started");
  }).catch((err) => {
    console.error("[mcp] MCP start failed:", err);
    process.exit(1);
  });
}

/**
 * 启动 MCP 通道
 *
 * 通用流程：
 *   1. 重定向 console.log 到 stderr（stdout 被 MCP stdio 占用）
 *   2. 启动 MCP stdio server（暴露出站工具）
 *   3. 建立反向 WebSocket 连接（connect 时传入 channel + prompt，一步完成注册）
 *   4. 接线入站：handler.setOnMessage → 组装 contextTags → channel.accept
 *   5. 启动平台 Handler
 *   6. 注册 SIGINT / SIGTERM 优雅退出
 */
function envOr(name: string, fallback: string): string {
  return process.env[name] ?? process.env[fallback] ?? "";
}

export function runMcpChannel(config: McpChannelConfig): void {
  const { handler, mcpServer } = config;
  const channelName = config.channelName ?? envOr("AIDO_MCP_NAME", "AILO_MCP_NAME");
  const ailoWsUrl = config.ailoWsUrl ?? envOr("AIDO_WS_URL", "AILO_WS_URL");
  const ailoToken = config.ailoToken ?? envOr("AIDO_TOKEN", "AILO_TOKEN");

  if (!ailoWsUrl || !ailoToken || !channelName) {
    console.error(
      "Missing AIDO_WS_URL/AILO_WS_URL, AIDO_TOKEN/AILO_TOKEN or AIDO_MCP_NAME/AILO_MCP_NAME. Channel must be started by Ailo MCP."
    );
    process.exit(1);
  }

  // stdout 被 MCP stdio 占用，日志全部走 stderr
  const _origLog = console.log;
  console.log = (...args: unknown[]) => console.error(...args);

  const tag = `[${channelName}]`;

  const channelPrompt = config.buildChannelPrompt
    ? config.buildChannelPrompt()
    : defaultBuildChannelPrompt();

  const client = new AiloClient(ailoWsUrl, ailoToken, channelName, channelPrompt);

  // 入站：平台 → Ailo（channel.accept）
  handler.setOnMessage(async (msg: BridgeMessage) => {
    const hasContent = (msg.text ?? "").trim() !== "" || (msg.attachments?.length ?? 0) > 0;
    if (!hasContent) {
      console.log(
        `${tag} skipped ${msg.chatType} ${msg.chatId} (no text or attachments)`
      );
      return;
    }

    console.log(
      `${tag} ${msg.chatType} ${msg.chatId} from ${msg.senderName ? msg.senderName + "(" + (msg.senderId ?? "") + ")" : msg.senderId ?? "unknown"}: ${(msg.text ?? "").slice(0, 80)}`
    );

    try {
      const isPrivate = msg.isPrivate ?? false;
      const groupLabel =
        !isPrivate &&
        (msg.chatName || (msg.chatId ? `群${msg.chatId.slice(-8)}` : ""));

      const contextTags: { key: string; desc: string; value: string }[] = [
        { key: "chat_type", desc: "类型", value: msg.chatType },
        { key: "chat_id", desc: "会话", value: msg.chatId },
      ];
      if (groupLabel) {
        contextTags.push({ key: "chat_name", desc: "群名", value: groupLabel });
      }
      contextTags.push(
        { key: "sender_name", desc: "昵称", value: msg.senderName ?? "" },
        { key: "sender_id", desc: "用户ID", value: msg.senderId ?? "" }
      );
      if (msg.mentionsSelf) {
        contextTags.push({ key: "mentions_self", desc: "提及自己", value: "true" });
      }

      if (msg.timestamp != null) {
        let tsMs: number;
        if (typeof msg.timestamp === "number") {
          tsMs = msg.timestamp;
        } else {
          tsMs = parseInt(msg.timestamp, 10);
        }
        if (!isNaN(tsMs) && tsMs > 0) {
          const d = new Date(tsMs);
          const pad = (n: number) => String(n).padStart(2, "0");
          const formatted = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
          contextTags.push({ key: "sent_at", desc: "发送时间", value: formatted });
        }
      }

      const coreForSenseContext: boolean[] = [];
      coreForSenseContext.push(true, true);
      if (groupLabel) {
        coreForSenseContext.push(true);
      }
      for (let i = coreForSenseContext.length; i < contextTags.length; i++) {
        coreForSenseContext.push(isPrivate);
      }

      await client.sendMessage({
        chatId: msg.chatId,
        text: msg.text ?? "",
        contextTags,
        coreForSenseContext,
        attachments: msg.attachments ?? [],
      });
    } catch (err) {
      console.error(`${tag} send to Ailo failed:`, err);
    }
  });

  // 优雅退出
  const shutdown = () => {
    console.log(`${tag} shutting down...`);
    handler.stop?.();
    client.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  (async () => {
    // 1. 启动 MCP stdio server
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.log(`${tag} MCP stdio server started`);

    // 2. 建立反向 WebSocket 连接
    try {
      await client.connect();
      console.log(`${tag} reverse WebSocket connected`);
    } catch (err) {
      console.error(`${tag} reverse WebSocket connect failed:`, err);
      process.exit(1);
    }

    // 3. 启动平台 Handler
    console.log(`${tag} starting handler...`);
    const startResult = handler.start();

    if (startResult && typeof (startResult as Promise<void>).then === "function") {
      try {
        await (startResult as Promise<void>);
        console.log(`${tag} handler started successfully`);
      } catch (err) {
        console.error(`${tag} handler start failed:`, err);
        process.exit(1);
      }
    }
  })();
}
