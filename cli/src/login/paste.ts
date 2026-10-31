/** Reading a pasted key without echoing it: raw mode on a terminal, the first line of stdin
 * otherwise (`pbpaste | trendsfast login --paste`). */
import type { Io } from "../io.js";

export function readSecretLine(io: Io, prompt: string): Promise<string> {
  const stdin = io.stdin;
  if (stdin.isTTY && typeof stdin.setRawMode === "function") {
    io.stderr.write(prompt);
    return new Promise((resolve, reject) => {
      let value = "";
      const finish = (error?: Error) => {
        stdin.setRawMode?.(false);
        stdin.removeListener("data", onData);
        stdin.pause();
        io.stderr.write("\n");
        if (error) reject(error);
        else resolve(value.trim());
      };
      const onData = (chunk: Buffer | string) => {
        for (const character of chunk.toString()) {
          if (character === "\r" || character === "\n") return finish();
          if (character === "\u0003") return finish(new Error("Cancelled."));
          if (character === "\u0004") return finish();
          if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
          else value += character;
        }
      };
      stdin.setRawMode?.(true);
      stdin.resume();
      stdin.on("data", onData);
    });
  }
  return new Promise((resolve, reject) => {
    let data = "";
    stdin.setEncoding?.("utf8");
    stdin.on("data", (chunk) => {
      data += chunk.toString();
    });
    stdin.on("end", () => resolve(data.split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? ""));
    stdin.on("error", reject);
  });
}

/** A yes/no question on a terminal. Anything but y or yes is no. */
export function confirm(io: Io, question: string): Promise<boolean> {
  io.stderr.write(`${question} [y/N] `);
  return new Promise((resolve) => {
    const onData = (chunk: Buffer | string) => {
      io.stdin.removeListener("data", onData);
      io.stdin.pause();
      resolve(/^\s*y(es)?\s*$/i.test(chunk.toString()));
    };
    io.stdin.resume();
    io.stdin.on("data", onData);
  });
}
