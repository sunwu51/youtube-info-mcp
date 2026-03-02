import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getYouTubeVideoInfo } from "../youtube-fetcher";

const subtitleSchema = z.object({
  languageCode: z.string().describe("Language code of the subtitle track, e.g. en, zh-Hans"),
  content: z.string().describe("Plain text content of the subtitle"),
});

const outputSchema = {
  title: z.string().describe("Video title"),
  author: z.string().describe("Video author / channel name"),
  viewCount: z.string().describe("Total view count"),
  description: z.string().describe("Video description"),
  lengthSeconds: z.string().describe("Video duration in seconds"),
  publishDate: z.string().describe("Video publish date, e.g. 2025-01-15"),
  subtitle: subtitleSchema
    .optional()
    .describe("Subtitle track, only present when includeSubtitles is true"),
};

export const setupMCPServer = (): McpServer => {
  const server = new McpServer(
    {
      name: "youtube-info-mcp",
      version: "1.0.0",
    },
    { capabilities: { logging: {} } }
  );

  server.registerTool(
    "get-youtube-video-info",
    {
      description:
        "Fetches YouTube video metadata (title, author, duration, description, publish date, view count) and subtitles/captions.",
      inputSchema: {
        url: z
          .string()
          .describe(
            "YouTube video URL, e.g. https://www.youtube.com/watch?v=xxxxx"
          ),
        includeSubtitles: z
          .boolean()
          .optional()
          .default(false)
          .describe("Whether to include subtitles/captions in the response"),
      },
      outputSchema,
    },
    async ({ url, includeSubtitles }): Promise<CallToolResult> => {
      try {
        const info = await getYouTubeVideoInfo(url, includeSubtitles);

        return {
          structuredContent: info as unknown as Record<string, unknown>,
          content: [
            {
              type: "text",
              text: JSON.stringify(info),
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: error.message }),
            },
          ],
        };
      }
    }
  );

  return server;
};
