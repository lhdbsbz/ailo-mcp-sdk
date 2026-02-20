/**
 * 返回 MCP 专属工作目录的绝对路径（AILO_MCP_WORKDIR）。
 * 框架拉起 stdio MCP 时注入，通道在此目录下自行规划子目录（blobs、cache 等）。
 * 无 workdir 时返回 null。
 */
export function getWorkDir(): string | null {
  const w = process.env.AILO_MCP_WORKDIR;
  return w || null;
}
