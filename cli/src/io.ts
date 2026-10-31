/** Everything the CLI touches outside itself, so tests can run it in-process. */
export interface OutputStream {
  write(chunk: string): unknown;
  isTTY?: boolean;
}

export interface InputStream extends NodeJS.ReadableStream {
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
}

export interface Io {
  stdout: OutputStream;
  stderr: OutputStream;
  stdin: InputStream;
  env: Record<string, string | undefined>;
  cwd: string;
  platform: NodeJS.Platform;
  now(): Date;
  /** For tests: replaces the global fetch for every call the CLI makes. */
  fetch?: typeof globalThis.fetch;
  /** For tests: replaces opening the system browser. Returns whether it opened. */
  openBrowser?: (url: string) => boolean;
}

export function processIo(): Io {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin,
    env: process.env,
    cwd: process.cwd(),
    platform: process.platform,
    now: () => new Date(),
  };
}

/** Whether both ends of the conversation are a person at a terminal. */
export function interactive(io: Io): boolean {
  return Boolean(io.stdin.isTTY && io.stdout.isTTY);
}

export function line(stream: OutputStream, text = ""): void {
  stream.write(`${text}\n`);
}
