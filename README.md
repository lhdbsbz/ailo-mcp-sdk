# @lmcl/ailo-mcp-sdk

AILO 通道与工具开发 SDK。

```bash
npm install @lmcl/ailo-mcp-sdk
```

**MCP → AILO 方向**：MCP 的 name 就是通道名，将来收到消息时用的就是这个名字。

---

## 场景1：纯工具（AILO → MCP 客户端）

AILO 调用你的工具，你返回结果。

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runMcp } from "@lmcl/ailo-mcp-sdk";

const server = new McpServer({ name: "my-tools", version: "1.0.0" });

server.registerTool("get_weather", { description: "查询天气", inputSchema: { city: z.string() } }, async ({ city }) => {
  return { content: [{ type: "text", text: `北京: 晴 25°C` }] };
});

runMcp(server);
```

---

## 场景2：纯接收（MCP 客户端 → AILO）

平台有事件时，你推送给 AILO。无工具。

### 1. 实现 BridgeHandler

```typescript
import type { BridgeHandler, BridgeMessage } from "@lmcl/ailo-mcp-sdk";

class MyHandler implements BridgeHandler {
  private onMessage?: (msg: BridgeMessage) => void;

  setOnMessage(fn: (msg: BridgeMessage) => void) {
    this.onMessage = fn;
  }

  async start() {
    // 启动平台连接（WebSocket / long polling 等）
    // 收到平台消息时调用：this.onMessage?.({ chatId, chatType: "群聊"|"私聊", text, senderId, senderName, chatName?, isPrivate?, ... })
  }

  stop?() {
    // 断开平台连接
  }
}
```

### 2. 启动（mcpServer 可空或只注册 status）

```typescript
import { runMcpChannel } from "@lmcl/ailo-mcp-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const handler = new MyHandler();
const server = new McpServer({ name: "my-channel", version: "1.0.0" });
// 纯接收无需注册工具，或注册 status 供 AILO 查看健康

runMcpChannel({
  handler,
  mcpServer: server,
  buildChannelPrompt: () => "本通道规则说明",
});
```

---

## 场景3：双向收发（AILO ↔ MCP 客户端）

AILO → MCP + MCP → AILO 组合。既推送事件给 AILO，也注册工具供 AILO 调用。

### 1. 实现 BridgeHandler（同纯接收）

### 2. 创建 MCP Server 并注册工具

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({ name: "my-channel", version: "1.0.0" });

server.registerTool("send_message", {
  description: "发送消息到平台",
  inputSchema: { chat_id: z.string(), text: z.string() },
}, async ({ chat_id, text }) => {
  // 调用 handler 或平台 API 发消息
  return { content: [{ type: "text", text: "已发送" }] };
});
```

### 3. 启动

```typescript
import { runMcpChannel } from "@lmcl/ailo-mcp-sdk";

const handler = new MyHandler();

runMcpChannel({
  handler,
  mcpServer: server,
  buildChannelPrompt: () => "本通道的规则说明，如 @提及格式、ID 格式等",
});
```

### 4. 需要存点数据时（可选）

数据存在 AILO 本体，所以只有 MCP → AILO 方向（有 WebSocket 连接）才有。SDK 连接后注入一个带 get/set/delete 的对象，直接用即可，自动持久化。更复杂的需求自行实现（不通过我们）。

```typescript
class MyHandler implements BridgeHandler {
  private kv: { getData: (k: string) => Promise<string | null>; setData: (k: string, v: string) => Promise<void>; deleteData: (k: string) => Promise<void> } | null = null;

  setDataProvider?(s) {
    this.kv = s;
  }

  // 直接用：await this.kv?.getData("key")
  //        await this.kv?.setData("key", "value")
  //        await this.kv?.deleteData("key")
}
```

---

## 配置项（runMcpChannel）

### AILO → MCP 方向（AILO 调用你的工具）


| 字段          | 必填  | 说明              |
| ----------- | --- | --------------- |
| `mcpServer` | 是   | 需注册工具，AILO 才能调用 |


### MCP → AILO 方向（你推送事件给 AILO）


| 字段                   | 必填  | 说明                           |
| -------------------- | --- | ---------------------------- |
| `handler`            | 是   | BridgeHandler 实例             |
| `buildChannelPrompt` | 否   | 通道规则提示词                      |
| `ailoWsUrl`          | 否   | stdio 时从 env 读取；**HTTP 时必须传**（通道与网关不同网络） |

---

## 环境变量（MCP → AILO 方向）

| 变量              | stdio 注入方式           | HTTP 注入方式           |
| --------------- | ---------------------- | ---------------------- |
| `AIDO_WS_URL`   | env 注入，主程序自动       | 主程序以 header `ailo-mcp-ws-url` 传给远程 MCP。**通道与网关不同网络时，你必须在 MCP 配置的 env 中填 `ailo-mcp-ws-url` 或 `AIDO_WS_URL`**，主程序会读取后放入 header |
| `AIDO_TOKEN`    | env 注入，主程序自动       | 主程序以 header `ailo-mcp-token` 传给远程 MCP，不可配置 |
| `AIDO_MCP_NAME` | env 注入，主程序自动       | 主程序以 header `ailo-mcp-name` 传给远程 MCP，严格按 MCP 的 name，不可配置 |


*无需了解*：通道回连时，服务端会校验 MCP 身份与凭证，双向链路均有认证保护，你只需写业务逻辑即可。

---

## 时空场格式

WebSocket（MCP → AILO）场景下，推送事件时用。

- **格式**：KV 数组。每项 `{ key, desc, value }`，`key` 框架用，`desc` 给 LLM 看，`value` 标签值。
- **顺序**：敏感，顺序决定语义。
- **coreForSenseContext**：与数组一一对应，`true` 表示该项参与时空场键。最左匹配，遇 `false` 即停。私聊全 `true`；群聊 `chat_type`/`chat_id`/`chat_name` 为 `true`，`sender_name` 起为 `false`。

---

## 类型速查


| 类型              | 说明 |
| --------------- | ---- |
| `BridgeHandler`、`BridgeMessage` | WebSocket（MCP → AILO）场景才用，推送给 AILO 的接口与时空场格式 |


