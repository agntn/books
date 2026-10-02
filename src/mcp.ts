import type { Server } from "@modelcontextprotocol/server";
import { createMcpServer as createToolServer } from "@agntn/tools/mcp";

import { bookTools } from "./tools.ts";
import { version } from "./version.ts";

/**
 * Create an MCP server exposing the book tools.
 *
 * @returns {Server} Unconnected MCP server.
 */
export function createMcpServer(): Server {
  return createToolServer({ name: "books", version }, bookTools);
}
