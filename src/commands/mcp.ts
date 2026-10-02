import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "mcp",
    description: "Run the Books MCP server over stdio",
  },
  /**
   * The SDK and the server load here, not at module scope.
   *
   * citty resolves every lazy subcommand to read its `meta` when rendering help, so a top-level
   * import would pull the MCP SDK into `books --help` and every other command.
   */
  async run() {
    const [{ StdioServerTransport }, { createMcpServer }] = await Promise.all([
      import("@modelcontextprotocol/server/stdio"),
      import("../mcp.ts"),
    ]);
    await createMcpServer().connect(new StdioServerTransport());
  },
});
