# @ailo/mcp-sdk

Ailo MCP SDK —— 通道通过 MCP 注册发送消息能力，用于开发飞书、邮件、Telegram 等感知通道。

## 安装

```bash
npm install @ailo/mcp-sdk
```

## 使用

```typescript
import { runMcpChannel, AiloClient } from "@ailo/mcp-sdk";
import type { BridgeHandler, BridgeMessage, DataProvider } from "@ailo/mcp-sdk";
```

### 实现 BridgeHandler

每个通道需实现 `BridgeHandler` 接口：

- `setOnMessage(handler)`：注册入站消息回调
- `start()`：启动平台连接（WebSocket / long polling 等）
- `stop?()`：可选，停止平台连接
- `setDataProvider?(provider)`：可选，接收持久化数据提供者

### 启动 MCP 通道

```typescript
runMcpChannel({
  channelName: "my-channel",
  handler: myHandler,
  ailoWsUrl: process.env.AILO_WS_URL!,
  ailoToken: process.env.AILO_TOKEN!,
  mcpServer: mcpServer,
  buildChannelPrompt: () => "通道特殊规则...",
});
```

## 环境变量

- `AILO_WS_URL`：Ailo WebSocket 网关地址
- `AILO_TOKEN`：Ailo 网关认证 Token

## 协议

通道通过反向 WebSocket 连接 Ailo 网关，支持：

- `channel.register`：注册通道提示词
- `channel.accept`：入站信号投递
- `channel.data.get/set/delete`：持久化数据读写

出站（AI → 平台）由 MCP stdio 工具处理。

## 发布

```bash
npm run build
npm publish --access public
```
