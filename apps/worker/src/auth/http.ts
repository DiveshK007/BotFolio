import type { IncomingMessage } from "node:http";

export const MAX_BODY_BYTES = 16 * 1024;
const BODY_TIMEOUT_MS = 5_000;

export class BodyError extends Error {
  override name = "BodyError";
}

/**
 * Reads a small JSON body. The cap is enforced on the bytes received, not only on content-length,
 * which a client can omit or fake. On error the caller must close the connection: the rest is unread.
 */
export function readJson(req: IncomingMessage, maxBytes = MAX_BODY_BYTES, timeoutMs = BODY_TIMEOUT_MS): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const type = req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json") return reject(new BodyError("not JSON"));
    if (Number(req.headers["content-length"] ?? 0) > maxBytes) return reject(new BodyError("too large"));

    const chunks: Buffer[] = [];
    let size = 0;
    const finish = (error?: BodyError) => {
      clearTimeout(timer);
      req.off("data", onData).off("end", onEnd).off("close", onClose).off("error", onClose);
      if (error) return reject(error);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new BodyError("bad JSON"));
      }
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) finish(new BodyError("too large"));
      else chunks.push(chunk);
    };
    const onEnd = () => finish();
    const onClose = () => finish(new BodyError("aborted"));
    const timer = setTimeout(() => finish(new BodyError("too slow")), timeoutMs);
    req.on("data", onData).on("end", onEnd).on("close", onClose).on("error", onClose);
  });
}
