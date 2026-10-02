#!/usr/bin/env node

/** Books CLI - unified book catalog and full-text commands */
import { existsSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand, runMain } from "citty";
import type McpCommand from "./commands/mcp.ts";
import { version } from "./version.ts";

/** Side-effect import: registers every built-in provider before the CLI parses arguments. */
import "./providers/index.ts";

/** Built at runtime so the bundler leaves `src` out; the npm package ships only `dist`. */
const sourceMcpCommand = new URL("../src/commands/mcp.ts", import.meta.url);
const sourceMcpCommandPath = fileURLToPath(sourceMcpCommand);

/**
 * Narrows the module a runtime URL import returned, which TypeScript types as `any`.
 * @param value - The imported module namespace.
 * @returns {value is { default: typeof McpCommand }} Whether it exports a default command.
 */
function isCommandModule(value: unknown): value is { default: typeof McpCommand } {
  return typeof value === "object" && value !== null && "default" in value;
}

/**
 * Inside a checkout the built bin serves `src/`, so a change needs a restart, not `pnpm build`.
 * A copy under `node_modules`, a run with `--no-strip-types` and `BOOKS_DIST=1` keep the bundle.
 * @returns {Promise<typeof McpCommand>} The citty command that starts the stdio server.
 */
async function loadMcpCommand(): Promise<typeof McpCommand> {
  const fromSource =
    !import.meta.url.endsWith(".ts") &&
    process.env["BOOKS_DIST"] !== "1" &&
    Boolean(process.features.typescript) &&
    !sourceMcpCommandPath.includes(`${sep}node_modules${sep}`) &&
    existsSync(sourceMcpCommandPath);
  if (!fromSource) return (await import("./commands/mcp.ts")).default;
  const module: unknown = await import(sourceMcpCommand.href);
  if (!isCommandModule(module)) {
    throw new TypeError(`${sourceMcpCommandPath} has no default command`);
  }
  return module.default;
}

/**
 * Exits quietly once the reader of stdout or stderr is gone (`| head -1`), keeping the exit code.
 * @param error - The error the stream emitted.
 */
function exitOnClosedPipe(error: Readonly<NodeJS.ErrnoException>): void {
  if (error.code !== "EPIPE") throw error;
  process.exit();
}

process.stdout.on("error", exitOnClosedPipe);
process.stderr.on("error", exitOnClosedPipe);

const main = defineCommand({
  meta: {
    name: "books",
    version,
    description: "Unified book catalog CLI",
  },
  subCommands: {
    search: () => import("./commands/search.ts").then((m) => m.default),
    get: () => import("./commands/get.ts").then((m) => m.default),
    text: () => import("./commands/text.ts").then((m) => m.default),
    "search-text": () => import("./commands/search-text.ts").then((m) => m.default),
    providers: () => import("./commands/providers.ts").then((m) => m.default),
    mcp: loadMcpCommand,
  },
});

await runMain(main);
