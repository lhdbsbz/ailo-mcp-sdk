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
  chatType: string;       // 时空场 chat_type 值，如 "群聊"、"私聊"
  text?: string;
  senderId?: string;
  senderName?: string;
  chatName?: string;      // 群聊时有值，私聊时无
  isPrivate?: boolean;    // 私聊为 true，不产生 chat_name
  mentionsSelf?: boolean;
  attachments?: Attachment[];
  timestamp?: number | string;
  messageId?: string;
};

/** setDataProvider 接收的对象，SDK 注入，直接用 get/set/delete 即可 */
type ChannelStorage = {
  getData(key: string): Promise<string | null>;
  setData(key: string, value: string): Promise<void>;
  deleteData(key: string): Promise<void>;
};

/**
 * 通道 Handler 统一接口
 */
export interface BridgeHandler {
  setOnMessage(handler: (msg: BridgeMessage) => void | Promise<void>): void;
  start(): void | Promise<void>;
  stop?(): void;
  /** 可选，SDK 连接后注入带 get/set/delete 的对象，直接用 */
  setDataProvider?(storage: ChannelStorage): void;
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
