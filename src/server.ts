import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./constants.js";
import { allTools } from "./tools/index.js";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
  });

  for (const tool of allTools) {
    const zodSchema = tool.schema as z.ZodObject<z.ZodRawShape>;
    server.tool(
      tool.name,
      tool.description,
      zodSchema.shape,
      async (params: Record<string, unknown>) => {
        try {
          const parsed = tool.schema.parse(params);
          const result = await tool.execute(parsed);

          // Validate MCP response format
          if (
            !result ||
            !Array.isArray(result.content) ||
            result.content.length === 0 ||
            !result.content.every((c: Record<string, unknown>) => typeof c.type === "string")
          ) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: `Tool '${tool.name}' returned invalid response format` }) }],
            };
          }

          return result as any;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
          };
        }
      },
    );
  }

  return server;
}
