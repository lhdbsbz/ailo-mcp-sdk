import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AiloClient } from "./ailo-client.js";
import type { BridgeHandler, BridgeMessage } from "./types.js";

/**
 * MCP 通道启动配置
 *
 * AILO_WS_URL、AILO_TOKEN、AILO_MCP_NAME 由主程序在拉起 MCP 时注入，SDK 自动读取。
 * 通道开发者只需提供 handler、mcpServer、buildChannelPrompt 等业务配置。
 */
export interface McpChannelConfig {
  /** MCP 名称（如 channel:feishu），connect 时与 token 一起发送供服务端校验。不传则从 AILO_MCP_NAME 读取 */
  channelName?: string;
  /** 中文通道显示名（如 "飞书"），握手时锁定，框架自动注入 TagChannel */
  displayName: string;
  /** 通道默认行为：true=主动信号（触发 LLM 处理），false=被动感知（仅记录）。默认 true */
  defaultRequiresResponse?: boolean;
  /** 平台 Handler 实例（需实现 BridgeHandler 接口） */
  handler: BridgeHandler;
  /** Ailo WebSocket 网关地址。不传则从 AILO_WS_URL 读取 */
  ailoWsUrl?: string;
  /** Ailo 网关认证 Token。不传则从 AILO_TOKEN 读取 */
  ailoToken?: string;
  /**
   * 构建通道静态提示词（connect 时注册）。
   * 逐步废弃：通道指令应迁移到 MCP 工具定义（tool schema description）中。
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
  // stdio-guard 需在入口 import，runMcp 使用者应 import 自 @lmcl/ailo-mcp-sdk
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
 *   1. stdio-guard 已在 index 入口加载，console.log 等自动重定向到 stderr
 *   2. 启动 MCP stdio server（暴露出站工具）
 *   3. 建立反向 WebSocket 连接（connect 时传入 channel + prompt，一步完成注册）
 *   4. 接线入站：handler.setOnMessage → 组装 contextTags → channel.accept
 *   5. 启动平台 Handler
 *   6. 注册 SIGINT / SIGTERM 优雅退出
 */
export function runMcpChannel(config: McpChannelConfig): void {
  const { handler, mcpServer } = config;
  const channelName = config.channelName ?? process.env.AILO_MCP_NAME ?? "";
  const ailoWsUrl = config.ailoWsUrl ?? process.env.AILO_WS_URL ?? "";
  const ailoToken = config.ailoToken ?? process.env.AILO_TOKEN ?? "";

  if (!ailoWsUrl || !ailoToken || !channelName) {
    console.error(
      "Missing AILO_WS_URL, AILO_TOKEN or AILO_MCP_NAME. Channel must be started by Ailo MCP."
    );
    process.exit(1);
  }

  // stdio-guard 已在 index 入口加载，console.log 等已重定向到 stderr
  const tag = `[${channelName}]`;

  const channelPrompt = config.buildChannelPrompt
    ? config.buildChannelPrompt()
    : defaultBuildChannelPrompt();

  const displayName = config.displayName;
  const defaultRequiresResponse = config.defaultRequiresResponse ?? true;

  const client = new AiloClient(ailoWsUrl, ailoToken, channelName, displayName, defaultRequiresResponse, channelPrompt);

  // 入站：平台 → Ailo（channel.accept），msg 必须自带 contextTags 或内容
  // 注意：被动感知信号（requiresResponse=false）允许无 text/attachments，只需有 contextTags
  handler.setOnMessage(async (msg: BridgeMessage) => {
    const hasContent = (msg.text?.trim() ?? "") !== "" || (msg.attachments?.length ?? 0) > 0 || msg.contextTags.length > 0;
    if (!hasContent) {
      console.log(`${tag} skipped (no text, attachments, or contextTags)`);
      return;
    }
    console.log(`${tag} ${(msg.text ?? "").slice(0, 80)}`);
    try {
      await client.sendMessage(msg);
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

    // 3. 注入持久化存储
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
