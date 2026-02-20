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
 * 时空场标签。
 *
 * kind: 受控词汇（channel/participant/group/conv_type/location/device/modality/chat_id/sender_id）
 * streamKey: 参与 stream_key 推导（标识事件流归属）
 * routing: 仅路由用途——不嵌入向量，不展示在历史邮戳
 */
export type ContextTag = {
  kind: string;
  value: string;
  streamKey: boolean;
  routing?: boolean;
};

/**
 * 桥接器入站消息（平台 → Ailo）
 *
 * 时空场模型：通道自己定义，全在 contextTags 里。
 */
export type BridgeMessage = {
  text?: string;
  contextTags: ContextTag[];
  attachments?: Attachment[];
  /** 本条消息是否需要 LLM 响应（覆盖通道级 defaultRequiresResponse） */
  requiresResponse?: boolean;
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
