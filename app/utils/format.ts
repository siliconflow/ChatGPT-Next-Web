import { SiliconFlow } from "../constant";

export type MsgError = "Recall" | "Empty";
export const EmptyMsg = "🤔 仿佛来到了信息的荒漠 ...";
export function prettyObject(msg: any) {
  if (msg.code === 30001 || msg.code === 30011) {
    return `⚠️ 不好，余额不足了，请先完成充值 👉 [立即充值](${SiliconFlow.BillPath})`;
  }
  if (msg.code === 50603) {
    return `⚠️系统繁忙，请稍后重试`;
  }
  if ((msg.message as MsgError) === "Recall") {
    return "👀 让我们换个话题聊聊吧";
  }
  if ((msg.message as MsgError) === "Empty") {
    return EmptyMsg;
  }
  const obj = msg;
  if (typeof msg !== "string") {
    msg = JSON.stringify(msg, null, "  ");
  }
  if (msg === "{}") {
    return obj.toString();
  }
  if (msg.startsWith("```json")) {
    return msg;
  }
  return ["```json", msg, "```"].join("\n");
}

export function* chunks(s: string, maxBytes = 1000 * 1000) {
  const decoder = new TextDecoder("utf-8");
  let buf = new TextEncoder().encode(s);
  while (buf.length) {
    let i = buf.lastIndexOf(32, maxBytes + 1);
    // If no space found, try forward search
    if (i < 0) i = buf.indexOf(32, maxBytes);
    // If there's no space at all, take all
    if (i < 0) i = buf.length;
    // This is a safe cut-off point; never half-way a multi-byte
    yield decoder.decode(buf.slice(0, i));
    buf = buf.slice(i + 1); // Skip space (if any)
  }
}
