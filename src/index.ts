import "./stdio-guard.js"; // 必须最先：stdout 被 MCP stdio 占用，框架层统一拦截非 JSON-RPC 输出

export { AiloClient } from "./ailo-client.js";
export { getWorkDir } from "./workdir.js";
export { runMcp, runMcpChannel, defaultBuildChannelPrompt } from "./bootstrap.js";
export type { McpChannelConfig } from "./bootstrap.js";
export type {
  Attachment,
  BridgeHandler,
  BridgeMessage,
  ContextTag,
} from "./types.js";
