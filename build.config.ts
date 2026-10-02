import { defineBuildConfig } from "obuild/config";

export default defineBuildConfig({
  entries: [
    {
      /** One bundle, so a provider registered through the package reaches MCP and the AI tools. */
      type: "bundle",
      input: ["./src/index.ts", "./src/cli.ts", "./src/mcp.ts", "./src/ai.ts", "./src/tools.ts"],
    },
  ],
});
