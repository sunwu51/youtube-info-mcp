# youtube-info-mcp

MCP server for fetching YouTube video metadata and subtitles. Deployed as a serverless function on Netlify with Streamable HTTP transport.

## Features

- Fetch video metadata: title, author, view count, description, duration, publish date
- Fetch subtitles: prioritizes English, falls back to Chinese, then any available language
- No API key required -- works by scraping public YouTube pages
- Stateless serverless deployment on Netlify

## Project Structure

```
netlify/
  youtube-fetcher.ts          # Core YouTube data-fetching logic
  mcp-server/
    index.ts                  # MCP server setup and tool registration
  functions/
    hono-mcp-server.ts        # Hono HTTP handler (Netlify Function entry point)
public/
  index.html                  # Static landing page
netlify.toml                  # Netlify deployment config
```

## Setup

```bash
npm install
```

Type-check only (Netlify handles the actual build):

```bash
npx tsc --noEmit
```

## Deployment

Deploy to Netlify. The MCP endpoint will be available at:

```
https://your-site.netlify.app/mcp
```

## MCP Client Configuration

### Cursor / Claude Desktop

```json
{
  "mcpServers": {
    "youtube-info": {
      "url": "https://your-site.netlify.app/mcp"
    }
  }
}
```

No API keys or environment variables are required.

## Tool: `get-youtube-video-info`

Fetches YouTube video metadata and optionally subtitles.

### Input

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `url` | string | Yes | - | YouTube video URL, e.g. `https://www.youtube.com/watch?v=xxxxx` |
| `includeSubtitles` | boolean | No | `false` | Whether to fetch subtitles/captions |

Supported URL formats:
- `https://www.youtube.com/watch?v=xxxxx`
- `https://youtu.be/xxxxx`
- `https://www.youtube.com/embed/xxxxx`
- `https://www.youtube.com/shorts/xxxxx`

### Output

```json
{
  "title": "Video title",
  "author": "Channel name",
  "viewCount": "12345",
  "description": "Video description",
  "lengthSeconds": "360",
  "publishDate": "2025-01-15T08:00:00+08:00",
  "subtitle": {
    "languageCode": "en",
    "content": "Subtitle text content"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `title` | string | Video title |
| `author` | string | Channel name |
| `viewCount` | string | Total view count |
| `description` | string | Video description |
| `lengthSeconds` | string | Video duration in seconds |
| `publishDate` | string | Publish time in ISO 8601 format with `+08:00` timezone |
| `subtitle` | object (optional) | Subtitle track, only present when `includeSubtitles` is `true` and subtitles are available |

### Subtitle Priority

When `includeSubtitles` is `true`, returns a single subtitle track with the following priority:

1. English (`en`)
2. Chinese (`zh`, `zh-Hans`, `zh-CN`, `zh-Hant`, `zh-TW`)
3. Any other available language

## How It Works

1. **Video info** -- Fetches the YouTube watch page HTML and extracts `ytInitialPlayerResponse` JSON to get video metadata.
2. **Subtitles** -- Calls YouTube's internal `youtubei/v1/player` API with `VISITOR_DATA` and `STS` tokens extracted from the page HTML to get caption track URLs, then fetches subtitle content in `json3` format.

## License

ISC
