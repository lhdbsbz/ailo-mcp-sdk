import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AiloClient } from "./ailo-client.js";
import type { BridgeHandler, BridgeMessage } from "./types.js";

/**
 * MCP 通道启动配置
 */
export interface McpChannelConfig {
  /** 通道标识（如 "feishu"、"email"），对应 Ailo 网关的 channel 字段 */
  channelName: string;
  /** 平台 Handler 实例（需实现 BridgeHandler 接口） */
  handler: BridgeHandler;
  /** Ailo WebSocket 网关地址（从 AILO_WS_URL 环境变量获取） */
  ailoWsUrl: string;
  /** Ailo 网关认证 Token（从 AILO_TOKEN 环境变量获取） */
  ailoToken: string;
  /**
   * 聊天类型 → 中文标签映射（用于 contextTags.chat_type 的值）
   * 例如：{ group: "群聊", p2p: "私聊" }
   */
  chatTypeLabels?: Record<string, string>;
  /**
   * 哪些 chatType 算作"私聊"（私聊不产生 chat_name 标签）
   * 例如：["p2p"]
   */
  privateTypes?: string[];
  /**
   * 构建通道静态提示词（channel.register 用）。
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
 * 启动 MCP 通道
 *
 * 通用流程：
 *   1. 重定向 console.log 到 stderr（stdout 被 MCP stdio 占用）
 *   2. 启动 MCP stdio server（暴露出站工具）
 *   3. 建立反向 WebSocket 连接到 Ailo（入站信号通道）
 *   4. 接线入站：handler.setOnMessage → 组装 contextTags → channel.accept
 *   5. 启动平台 Handler
 *   6. 注册 SIGINT / SIGTERM 优雅退出
 */
export function runMcpChannel(config: McpChannelConfig): void {
  const { channelName, handler, mcpServer } = config;

  // stdout 被 MCP stdio 占用，日志全部走 stderr
  const _origLog = console.log;
  console.log = (...args: unknown[]) => console.error(...args);

  const tag = `[${channelName}]`;

  const channelPrompt = config.buildChannelPrompt
    ? config.buildChannelPrompt()
    : defaultBuildChannelPrompt();

  const client = new AiloClient(
    config.ailoWsUrl,
    config.ailoToken,
    channelName,
    channelPrompt,
  );

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
      const typeLabel = config.chatTypeLabels?.[msg.chatType] ?? msg.chatType;
      const isPrivate = config.privateTypes?.includes(msg.chatType) ?? false;
      const groupLabel =
        !isPrivate &&
        (msg.chatName || (msg.chatId ? `群${msg.chatId.slice(-8)}` : ""));

      const contextTags: { key: string; desc: string; value: string }[] = [
        { key: "chat_type", desc: "类型", value: typeLabel },
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

    // 3. 注入持久化数据提供者
    if (handler.setDataProvider) {
      handler.setDataProvider(client);
    }

    // 4. 启动平台 Handler
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
