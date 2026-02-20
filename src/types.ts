/**
 * 附件类型（图片/音频/视频/文件等）
 * 入站图片：path/url/base64 三选一，直接使用 LLM 多模态。其他类型：path/url/ref+channel/base64。
 * 出站：file_path 或 base64 或 url。
 */
export type Attachment = {
  type: string;
  url?: string;
  path?: string;
  ref?: string;
  channel?: string;
  base64?: string;
  mime?: string;
  name?: string;
  file_path?: string;
};

/**
 * 桥接器入站消息（平台 → Ailo）
 *
 * 所有平台 Handler 的 onMessage 回调统一使用此类型。
 */
export type BridgeMessage = {
  chatId: string;
  messageId?: string;
  senderId?: string;
  senderName?: string;
  chatType: string;
  chatName?: string;
  text?: string;
  mentionsSelf?: boolean;
  attachments?: Attachment[];
  timestamp?: number | string;
};

/**
 * 通道持久化数据提供者（由 AiloClient 实现，通过 runMcpChannel 注入）
 */
export interface DataProvider {
  getData(key: string): Promise<string | null>;
  getDataByPrefix(prefix: string): Promise<Record<string, string>>;
  setData(key: string, value: string): Promise<void>;
  setDataBatch(items: Record<string, string>): Promise<void>;
  deleteData(key: string): Promise<void>;
  deleteDataByPrefix(prefix: string): Promise<void>;
}

/**
 * 通道 Handler 统一接口
 *
 * 每个通道（Feishu、Email 等）需实现此接口。
 * 入站由 runMcpChannel() 接线到反向 WebSocket（channel.accept）。
 * 出站由通道自行注册 MCP 工具，直接调用 handler 方法。
 */
export interface BridgeHandler {
  /** 注册入站消息回调 */
  setOnMessage(handler: (msg: BridgeMessage) => void | Promise<void>): void;
  /** 启动平台连接（WebSocket 长连接 / long polling 等） */
  start(): void | Promise<void>;
  /** 停止平台连接（可选） */
  stop?(): void;
  /** 注入持久化数据提供者（可选，由 runMcpChannel 在连接后自动调用） */
  setDataProvider?(provider: DataProvider): void;
}

/**
 * channel.accept 的 contextTags 项
 *
 * key:  框架内部路由用（英文标识）
 * desc: 给 LLM 看的人类可读标签（中文）
 * value: 标签值
 */
export type ContextTag = { key: string; desc: string; value: string };

/**
 * channel.accept 的消息参数
 *
 * coreForSenseContext: 与 contextTags 一一对应，true 表示该标签参与时空场键生成。
 * 最左匹配：遇 false 即停。私聊全 true；群聊 chat_type/chat_id/chat_name 为 true，sender_name 起为 false。
 * 未传时框架回退 Channel+ChatID。
 */
export type ChannelAcceptParams = {
  chatId: string;
  text: string;
  contextTags: ContextTag[];
  coreForSenseContext?: boolean[];
  attachments?: Attachment[];
};
