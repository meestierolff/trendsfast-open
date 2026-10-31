/** Opening the sign-in page, and telling whether this machine can show one at all. */
import { spawn } from "node:child_process";
import type { Io } from "../io.js";

export function isSsh(env: Io["env"]): boolean {
  return Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);
}

/** Whether a browser opened here can reach this machine's 127.0.0.1: a local desktop
 * session. Containers, cloud agents and SSH sessions have none. */
export function hasDisplay(io: Pick<Io, "env" | "platform">): boolean {
  if (isSsh(io.env)) return false;
  if (io.platform === "win32" || io.platform === "darwin") return true;
  return Boolean(io.env.DISPLAY || io.env.WAYLAND_DISPLAY);
}

/** Opens `url` in the default browser without a shell. Returns whether a launcher started;
 * the URL is always printed as well, so a launcher that fails costs nothing. */
export function openBrowser(url: string, io: Pick<Io, "env" | "platform">): boolean {
  const [command, args, options] =
    io.platform === "darwin"
      ? (["open", [url], {}] as const)
      : io.platform === "win32"
        ? (["cmd.exe", ["/d", "/s", "/c", `start "" "${url}"`], { windowsVerbatimArguments: true }] as const)
        : ([io.env.BROWSER?.trim() || "xdg-open", [url], {}] as const);
  try {
    const child = spawn(command, [...args], { stdio: "ignore", detached: true, windowsHide: true, ...options });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
