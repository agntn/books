#!/usr/bin/env node

/** Books CLI: a command per book tool, a `get` that tells an ISBN from a title, and MCP. */
import { existsSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "@agntn/tools/cli";
import { getCommand, textCommand } from "./cli-commands.ts";
import { BooksError } from "./core/errors.ts";
import type { createMcpServer } from "./mcp.ts";
import { bookTools } from "./tools.ts";
import { version } from "./version.ts";

/** Built at runtime so the bundler leaves `src` out; the npm package ships only `dist`. */
const sourceMcp = new URL("../src/mcp.ts", import.meta.url);
const sourceMcpPath = fileURLToPath(sourceMcp);

/**
 * Narrows the module a runtime URL import returned, which TypeScript types as `any`.
 * @param value - The imported module namespace.
 * @returns {value is { createMcpServer: typeof createMcpServer }} Whether it exports the server.
 */
function isMcpModule(value: unknown): value is { createMcpServer: typeof createMcpServer } {
  return typeof value === "object" && value !== null && "createMcpServer" in value;
}

/**
 * Inside a checkout `books mcp` serves `src/`, so a change needs a restart, not `pnpm build`.
 * A copy under `node_modules`, a run with `--no-strip-types` and `BOOKS_DIST=1` keep the bundle.
 * @param argv - Every argument after the bin.
 * @returns {boolean} Whether the line is a bare `mcp` and the source is there to serve.
 */
function servesSource(argv: readonly string[]): boolean {
  return (
    argv.length === 1 &&
    argv[0] === "mcp" &&
    !import.meta.url.endsWith(".ts") &&
    process.env["BOOKS_DIST"] !== "1" &&
    Boolean(process.features.typescript) &&
    !sourceMcpPath.includes(`${sep}node_modules${sep}`) &&
    existsSync(sourceMcpPath)
  );
}

/**
 * Serves `src/mcp.ts` over stdio, with the registry that source fills itself.
 * @returns {Promise<void>} Once the server is connected.
 */
async function serveSource(): Promise<void> {
  const module: unknown = await import(sourceMcp.href);
  if (!isMcpModule(module)) throw new TypeError(`${sourceMcpPath} has no createMcpServer`);
  const { StdioServerTransport } = await import("@modelcontextprotocol/server/stdio");
  await module.createMcpServer().connect(new StdioServerTransport());
}

const argv = process.argv.slice(2);
if (servesSource(argv)) {
  await serveSource();
} else {
  await runCli(
    {
      name: "books",
      version,
      description: "Unified book catalog CLI",
      tools: bookTools,
      commands: [getCommand, textCommand],
      mcp: true,
      expected: (error) => error instanceof BooksError,
    },
    argv,
  );
}
