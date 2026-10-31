#!/usr/bin/env node
import { processIo } from "./io.js";
import { LISTENER_COMMAND } from "./login/background.js";
import { main } from "./main.js";

const argv = process.argv.slice(2);
main(argv, processIo()).then(
  (code) => {
    // The detached sign-in listener exits as soon as it is done.
    if (argv[0] === LISTENER_COMMAND) process.exit(code);
    process.exitCode = code;
  },
  (error: unknown) => {
    if (argv[0] !== LISTENER_COMMAND) process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(argv[0] === LISTENER_COMMAND ? 1 : 7);
  },
);
