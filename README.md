# @lmcl/ailo-mcp-sdk

**AILO 通道与工具开发 SDK** —— 在标准 MCP 基础上，提供**双向通道**能力：既能接收平台消息推送给 AILO，也能让 AILO 通过工具向平台发送消息。

```bash
npm install @lmcl/ailo-mcp-sdk
```

---

## 核心概念

| 概念 | 说明 |
|------|------|
| **MCP** | Model Context Protocol，标准工具协议。AILO 通过 stdio 调用你的工具，你返回结果 |
| **通道** | 感知通道。平台（飞书、Telegram 等）有消息时推送给 AILO，AILO 通过工具发消息回平台 |
| **双向** | 通道 = MCP 工具（出站）+ WebSocket 推送（入站）。本 SDK 将二者统一 |

**通道名**：就是 MCP 名。

---

## 快速开始

### 场景一：纯工具（AILO 调用你，你返回结果）

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runMcp } from "@lmcl/ailo-mcp-sdk";

const server = new McpServer({ name: "my-tools", version: "1.0.0" });

server.registerTool(
  "get_weather",
  { description: "查询天气", inputSchema: { city: z.string() } },
  async ({ city }) => ({ content: [{ type: "text", text: `${city}: 晴 25°C` }] })
);

runMcp(server);
```

### 场景二：纯接收（平台有事件时推送给 AILO）

```typescript
import type { BridgeHandler, BridgeMessage } from "@lmcl/ailo-mcp-sdk";
import { runMcpChannel } from "@lmcl/ailo-mcp-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

class MyHandler implements BridgeHandler {
  private onMessage?: (msg: BridgeMessage) => void;

  setOnMessage(fn: (msg: BridgeMessage) => void) {
    this.onMessage = fn;
  }

  async start() {
    // 启动平台连接（WebSocket / long polling 等）
    // 收到消息时：this.onMessage?.({ text, contextTags, attachments? })
  }

  stop?() {
    // 断开平台连接
  }
}

const handler = new MyHandler();
const server = new McpServer({ name: "channel:my-platform", version: "1.0.0" });

runMcpChannel({
  handler,
  mcpServer: server,
  buildChannelPrompt: () => "本通道规则说明（如 @提及格式、ID 格式等）",
});
```

### 场景三：双向收发（既有推送，也有工具）

在场景二基础上，给 MCP Server 注册发消息工具即可：

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({ name: "channel:my-platform", version: "1.0.0" });

server.registerTool(
  "send_message",
  {
    description: "发送消息到平台",
    inputSchema: { chat_id: z.string(), text: z.string() },
  },
  async ({ chat_id, text }) => {
    // 调用平台 API 或 handler 发消息
    return { content: [{ type: "text", text: "已发送" }] };
  }
);

runMcpChannel({
  handler: new MyHandler(),
  mcpServer: server,
  buildChannelPrompt: () => "本通道规则说明",
});
```

---

## 重要：stdio 与日志

MCP 使用 **stdio** 传输，**stdout 只能输出 JSON-RPC 消息**。任何 `console.log`、第三方库日志写入 stdout 都会破坏协议，导致解析错误。

**本 SDK 已内置保护**：自动拦截 stdout，仅 JSON-RPC 转发到 stdout，其余重定向到 stderr。你可以自由使用 `console.log`、`console.info`、`console.debug`，以及会打日志的第三方库（如飞书 SDK），无需额外处理。

**入口顺序**：请将 `import { runMcpChannel } from "@lmcl/ailo-mcp-sdk"` 作为入口文件的**首个 import**，确保保护在 dotenv、平台 SDK 等之前生效。若入口结构复杂，可显式第一行写：

```typescript
import "@lmcl/ailo-mcp-sdk/stdio-guard";
import "dotenv/config";
import { runMcpChannel } from "@lmcl/ailo-mcp-sdk";
```

---

## BridgeHandler 接口

通道需实现 `BridgeHandler`，负责平台连接与消息转发：

| 方法 | 必填 | 说明 |
|------|------|------|
| `setOnMessage(fn)` | 是 | SDK 注入回调。平台有消息时调用 `fn(msg)`，msg 必须自带 contextTags（时空场） |
| `start()` | 是 | 启动平台连接（WebSocket / long polling 等） |
| `stop?()` | 否 | 断开平台连接，优雅退出时调用 |
| `setDataProvider?(storage)` | 否 | SDK 连接后注入持久化存储，用于通道数据（如外部用户映射） |

### BridgeMessage（时空场模型）

通道自己定义，全在 contextTags 里：

| 字段 | 类型 | 说明 |
|------|------|------|
| `text` | string | 消息正文 |
| `contextTags` | ContextTag[] | 时空场标签，必须 |
| `attachments` | Attachment[]? | 附件 |

---

## 通道持久化数据（可选）

通道运行时产生的持久化数据（如外部用户映射）可存于 AILO 本体。实现 `setDataProvider` 后，SDK 会注入带 `getData` / `setData` / `deleteData` 的对象：

```typescript
class MyHandler implements BridgeHandler {
  private storage: {
    getData(key: string): Promise<string | null>;
    setData(key: string, value: string): Promise<void>;
    deleteData(key: string): Promise<void>;
  } | null = null;

  setDataProvider(storage: typeof this.storage) {
    this.storage = storage;
  }

  async someMethod() {
    const v = await this.storage?.getData("key");
    await this.storage?.setData("key", "value");
    await this.storage?.deleteData("key");
  }
}
```

---

## 配置项（runMcpChannel）

| 字段 | 必填 | 说明 |
|------|------|------|
| `handler` | 是 | BridgeHandler 实例 |
| `mcpServer` | 是 | MCP Server 实例（需注册工具，AILO 才能调用） |
| `buildChannelPrompt` | 否 | 通道规则提示词，connect 时注册 |
| `channelName` | 否 | 通道名，不传则从 `AILO_MCP_NAME` 读取 |
| `ailoWsUrl` | 否 | AILO WebSocket 地址，不传则从 `AILO_WS_URL` 读取 |
| `ailoToken` | 否 | 认证 Token，不传则从 `AILO_TOKEN` 读取 |

---

## 环境变量

由 AILO 主程序在拉起 MCP 时注入，通道通常无需手动配置：

| 变量 | 说明 |
|------|------|
| `AILO_WS_URL` | AILO WebSocket 网关地址。通道与网关不同网络时，需在 MCP 配置的 env 中显式填写 |
| `AILO_TOKEN` | 认证 Token |
| `AILO_MCP_NAME` | MCP 名（即通道名），AILO 注入 |
| `AILO_MCP_WORKDIR` | MCP 专属工作目录（绝对路径）。框架拉起 stdio MCP 时创建并注入，通道可在此目录下规划子目录（如 `blobs`、`cache`） |

**获取工作目录**：`import { getWorkDir } from "@lmcl/ailo-mcp-sdk"`，`getWorkDir()` 返回 `AILO_MCP_WORKDIR` 或 `null`。

---

## 时空场（ContextTags）

每条消息必须带 contextTags，通道自己定义。格式：`{ desc, value, core }[]`。`desc` 给 LLM 看，`value` 为标签值，`core` 表示是否参与时空场键。

---

## 类型与导出

```typescript
import {
  runMcp,
  runMcpChannel,
  getWorkDir,
  defaultBuildChannelPrompt,
} from "@lmcl/ailo-mcp-sdk";
import type {
  BridgeHandler,
  BridgeMessage,
  Attachment,
  ContextTag,
  McpChannelConfig,
} from "@lmcl/ailo-mcp-sdk";
```

---

## 依赖

- Node.js >= 18
- `@modelcontextprotocol/sdk` ^1.26.0
- `ws` ^8.18.0
