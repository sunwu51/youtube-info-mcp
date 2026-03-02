/**
 * YouTube video info fetcher.
 *
 * Fetches the YouTube watch page HTML, extracts `ytInitialPlayerResponse` JSON,
 * and optionally retrieves subtitles via the youtubei/v1/player API.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VideoInfo {
  title: string;
  author: string;
  viewCount: string;
  description: string;
  lengthSeconds: string;
  publishDate: string;
  subtitle?: SubtitleTrack;
}

export interface SubtitleTrack {
  languageCode: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15";
const YT_CONSENT_COOKIE = "CONSENT=YES+cb.20210328-17-p0.en+FX+471";

/**
 * Extract the video ID from various YouTube URL formats.
 */
function extractVideoId(url: string): string {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  throw new Error(`Could not extract video ID from URL: ${url}`);
}

/**
 * Extract a JSON object that starts right after `prefix` in `text`.
 * Handles nested braces so we grab the complete object.
 */
function extractJsonAfterPrefix(text: string, prefix: string): unknown {
  const idx = text.indexOf(prefix);
  if (idx === -1) throw new Error(`Could not find "${prefix}" in page HTML`);

  const start = idx + prefix.length;
  let braceCount = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") braceCount++;
    if (ch === "}") {
      braceCount--;
      if (braceCount === 0) {
        return JSON.parse(text.substring(start, i + 1));
      }
    }
  }

  throw new Error("Could not extract complete JSON object from page HTML");
}

function tryExtractJsonAfterPrefix(text: string, prefix: string): unknown | null {
  try {
    return extractJsonAfterPrefix(text, prefix);
  } catch {
    return null;
  }
}

/**
 * Safely traverse a nested object by dot-separated path.
 */
function getNestedValue(obj: any, path: string): any {
  return path.split(".").reduce((acc, key) => acc?.[key], obj);
}

/**
 * Convert a publish date string to ISO 8601 format with +08:00 timezone.
 * Handles both date-only ("2025-01-15") and full ISO ("2025-12-26T14:04:34-08:00") formats.
 * Example output: 2025-01-15T00:00:00+08:00
 */
function formatPublishDateToUTC8(dateStr: string): string {
  if (!dateStr) return "";

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;

  // Convert to UTC+8
  const utc8Offset = 8 * 60; // minutes
  const localOffset = date.getTimezoneOffset(); // minutes
  const utc8Time = new Date(
    date.getTime() + (utc8Offset + localOffset) * 60 * 1000
  );

  const year = utc8Time.getFullYear();
  const month = String(utc8Time.getMonth() + 1).padStart(2, "0");
  const day = String(utc8Time.getDate()).padStart(2, "0");
  const hours = String(utc8Time.getHours()).padStart(2, "0");
  const minutes = String(utc8Time.getMinutes()).padStart(2, "0");
  const seconds = String(utc8Time.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+08:00`;
}

// ---------------------------------------------------------------------------
// Core: fetch watch page
// ---------------------------------------------------------------------------

async function fetchWatchPageHtml(videoId: string): Promise<string> {
  const urls = [
    `https://www.youtube.com/watch?v=${videoId}&hl=en&bpctr=9999999999&has_verified=1`,
    `https://www.youtube.com/watch?v=${videoId}`,
    `https://m.youtube.com/watch?v=${videoId}&hl=en&bpctr=9999999999&has_verified=1`,
  ];

  let lastError = "Unknown error";

  for (const url of urls) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Cookie: YT_CONSENT_COOKIE,
      },
    });

    if (!res.ok) {
      lastError = `Failed to fetch YouTube page: ${res.status} ${res.statusText}`;
      continue;
    }

    const html = await res.text();
    if (html.includes("ytInitialPlayerResponse")) {
      return html;
    }

    lastError = "YouTube page did not contain ytInitialPlayerResponse";
  }

  throw new Error(lastError);
}

// ---------------------------------------------------------------------------
// Core: parse video info from page HTML
// ---------------------------------------------------------------------------

function parseVideoInfo(html: string): {
  videoInfo: Omit<VideoInfo, "subtitle">;
  visitorData: string;
  sts: number;
} {
  const playerResponse =
    (tryExtractJsonAfterPrefix(html, "var ytInitialPlayerResponse = ") as any) ??
    (tryExtractJsonAfterPrefix(html, "ytInitialPlayerResponse = ") as any) ??
    (tryExtractJsonAfterPrefix(html, '"ytInitialPlayerResponse":') as any);

  if (!playerResponse) {
    throw new Error("Could not parse ytInitialPlayerResponse from page HTML");
  }

  const videoDetails = playerResponse?.videoDetails;
  if (!videoDetails) {
    const reason =
      getNestedValue(playerResponse, "playabilityStatus.reason") ??
      getNestedValue(playerResponse, "playabilityStatus.messages.0");
    throw new Error(
      `Could not find videoDetails in ytInitialPlayerResponse${
        reason ? ` (playabilityStatus: ${reason})` : ""
      }`
    );
  }

  const rawPublishDate: string =
    getNestedValue(
      playerResponse,
      "microformat.playerMicroformatRenderer.publishDate"
    ) ?? "";

  const videoInfo: Omit<VideoInfo, "subtitle"> = {
    title: videoDetails.title ?? "",
    author: videoDetails.author ?? "",
    viewCount: videoDetails.viewCount ?? "",
    description: videoDetails.shortDescription ?? "",
    lengthSeconds: videoDetails.lengthSeconds ?? "",
    publishDate: formatPublishDateToUTC8(rawPublishDate),
  };

  // Extract VISITOR_DATA and STS for subtitle fetching
  const visitorDataMatch = html.match(/"VISITOR_DATA":"([^"]*)"/);
  const stsMatch = html.match(/"STS":([0-9]*)/);

  const visitorData = visitorDataMatch?.[1] ?? "";
  const sts = stsMatch ? parseInt(stsMatch[1], 10) : 0;

  return { videoInfo, visitorData, sts };
}

// ---------------------------------------------------------------------------
// Core: fetch subtitles
// ---------------------------------------------------------------------------

async function fetchCaptionTracks(
  videoId: string,
  visitorData: string,
  sts: number
): Promise<Array<{ baseUrl: string; languageCode: string }>> {
  const payload = {
    context: {
      client: {
        clientName: "WEB",
        clientVersion: "2.20260114.08.00",
      },
    },
    videoId,
    playbackContext: {
      contentPlaybackContext: {
        html5Preference: "HTML5_PREF_WANTS",
        signatureTimestamp: sts,
      },
    },
    contentCheckOk: true,
    racyCheckOk: true,
  };

  const res = await fetch(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        Origin: "https://www.youtube.com",
        "X-YouTube-Client-Name": "1",
        "X-YouTube-Client-Version": "2.20260114.08.00",
        "X-Goog-Visitor-Id": visitorData,
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    throw new Error(
      `Failed to fetch player API: ${res.status} ${res.statusText}`
    );
  }

  const data = (await res.json()) as any;
  const tracks: any[] =
    data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!tracks || !Array.isArray(tracks)) {
    return [];
  }

  return tracks.map((t: any) => ({
    baseUrl: t.baseUrl ?? "",
    languageCode: t.languageCode ?? "",
  }));
}

async function fetchSubtitleContent(baseUrl: string): Promise<string> {
  const url = baseUrl + "&fmt=json3";
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
    },
  });

  if (!res.ok) {
    throw new Error(
      `Failed to fetch subtitle: ${res.status} ${res.statusText}`
    );
  }

  const data = (await res.json()) as any;
  const events: any[] = data?.events;
  if (!events || !Array.isArray(events)) return "";

  return events
    .flatMap((event: any) => {
      const segs: any[] = event?.segs;
      if (!segs || !Array.isArray(segs)) return [];
      return segs.map((seg: any) => (seg?.utf8 != null ? seg.utf8 : ""));
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getYouTubeVideoInfo(
  url: string,
  includeSubtitles: boolean = false
): Promise<VideoInfo> {
  const videoId = extractVideoId(url);
  const html = await fetchWatchPageHtml(videoId);
  const { videoInfo, visitorData, sts } = parseVideoInfo(html);

  if (!includeSubtitles) {
    return videoInfo;
  }

  // Fetch subtitles — priority: English > Chinese > any
  const captionTracks = await fetchCaptionTracks(videoId, visitorData, sts);

  if (captionTracks.length === 0) {
    return videoInfo;
  }

  const englishTrack = captionTracks.find((t) => t.languageCode === "en");
  const chineseTrack = captionTracks.find(
    (t) =>
      t.languageCode === "zh" ||
      t.languageCode === "zh-Hans" ||
      t.languageCode === "zh-CN" ||
      t.languageCode === "zh-Hant" ||
      t.languageCode === "zh-TW"
  );
  const selectedTrack = englishTrack || chineseTrack || captionTracks[0];

  const content = await fetchSubtitleContent(selectedTrack.baseUrl);
  const subtitle: SubtitleTrack = {
    languageCode: selectedTrack.languageCode,
    content,
  };

  return { ...videoInfo, subtitle };
}
