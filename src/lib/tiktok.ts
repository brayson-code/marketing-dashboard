// TikTok integration — STUB.
//
// The real implementation will use the TikTok Business API
// (https://business-api.tiktok.com — NOT open-api.tiktokglobalshop.com, which
// is Shop-only) via Nango with providerConfigKey = 'tiktok'.
//
// Planned endpoints once wired:
//   - /v1.3/user/info/                       → username, follower_count, etc.
//   - /v2/research/user/info/                → profile_views, video_views (if granted)
//   - /v2/research/video/query/              → recent videos (3 most recent for the panel)
//   - /v2/research/video/info/               → per-video view + watch-time data
//
// Metrics the analytics panel will surface:
//   video_views, profile_views, follower_count, engagement_rate, avg_watch_time.
//
// Until the OAuth app is approved and the Nango integration exists, `isConnected`
// is hard-false so the panel renders the "not connected" empty state.

export async function isConnected(): Promise<boolean> {
  return false;
}
