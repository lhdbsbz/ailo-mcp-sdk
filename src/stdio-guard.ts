/**
 * MCP stdio 保护层
 *
 * MCP 协议规定：stdout 只能输出 JSON-RPC 消息，任何其他输出都会导致客户端解析失败（如 invalid character 'i'）。
 * 本模块在框架层统一拦截 process.stdout.write，仅将以 `{` 开头的行（JSON-RPC）转发到真实 stdout，
 * 其余全部转发到 stderr。
 *
 * 通道开发者可以自由使用 console.log、console.info、console.debug，以及第三方库的日志，
 * 框架会自动重定向，无需担心污染 MCP 协议。
 *
 * 使用方式：入口文件将 `import { runMcpChannel } from "@lmcl/ailo-mcp-sdk"` 作为首个 import，
 * 确保本保护在 dotenv、平台 SDK 等可能写 stdout 的模块之前生效。
 *
 * 若入口结构复杂，可显式：`import "@lmcl/ailo-mcp-sdk/stdio-guard"` 作为第一行。
 */

const realStdoutWrite = process.stdout.write.bind(process.stdout);
let lineBuffer = "";
const MAX_LINE_BUFFER = 64 * 1024; // 64KB，防止异常情况下无限增长

function routeLine(line: string): "stdout" | "stderr" {
  const trimmed = line.trim();
  if (trimmed.length === 0) return "stderr"; // 空行不输出，避免干扰
  return trimmed.startsWith("{") ? "stdout" : "stderr";
}

process.stdout.write = function (
  chunk: string | Buffer | Uint8Array,
  encodingOrCallback?: BufferEncoding | ((err?: Error) => void),
  callback?: (err?: Error) => void
): boolean {
  const enc = typeof encodingOrCallback === "function" ? undefined : encodingOrCallback;
  const cb = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
  const str = typeof chunk === "string" ? chunk : chunk.toString();
  lineBuffer += str;
  if (lineBuffer.length > MAX_LINE_BUFFER) {
    lineBuffer = lineBuffer.slice(-MAX_LINE_BUFFER);
  }
  const lines = lineBuffer.split(/\r?\n/);
  lineBuffer = lines.pop() ?? "";
  const toStdout: string[] = [];
  const toStderr: string[] = [];
  for (const line of lines) {
    const dest = routeLine(line);
    const withNewline = line + "\n";
    if (dest === "stdout") toStdout.push(withNewline);
    else toStderr.push(withNewline);
  }
  if (toStderr.length > 0) {
    process.stderr.write(toStderr.join(""));
  }
  if (toStdout.length > 0) {
    const wrappedCb = cb ? (err?: Error | null) => cb(err ?? undefined) : undefined;
    return realStdoutWrite(toStdout.join(""), enc, wrappedCb);
  }
  if (cb) cb();
  return true;
};

process.on("beforeExit", () => {
  if (lineBuffer.length > 0) {
    const dest = routeLine(lineBuffer);
    const out = lineBuffer + "\n";
    if (dest === "stdout") realStdoutWrite(out);
    else process.stderr.write("[stdio-guard] 未完成行: " + out);
  }
});

// 重定向 console 到 stderr，开发者可自由使用
const toStderr = (...args: unknown[]) => console.error(...args);
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;
console.trace = toStderr;
