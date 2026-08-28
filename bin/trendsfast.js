#!/usr/bin/env node

import { formatCliError, runCli } from "../dist/cli.js";

void runCli(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`trendsfast: ${formatCliError(error)}\n`);
  process.exitCode = 1;
});
