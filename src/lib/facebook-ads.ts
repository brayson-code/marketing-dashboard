// Facebook Ads integration — STUB.
//
// The real implementation will:
//   1. Wire a Nango integration with `providerConfigKey = 'facebook-ads'` against
//      the Meta Marketing API (https://graph.facebook.com/v19.0).
//   2. Resolve the connected `ad_account_id` (act_<id>) for the tenant.
//   3. Pull last-30-day insights from `/{ad_account_id}/insights` with fields:
//      spend, impressions, clicks, ctr, cpm, frequency, reach, actions,
//      purchase_roas, video_avg_time_watched_actions.
//   4. Compute Avg Hold Rate (video_view_25 / impressions or watch_time/length).
//   5. Surface them via /api/integrations/facebook-ads/stats which the panel
//      already expects.
//
// Until then, `isConnected` is hard-false so the panel renders the "not
// connected" empty state and nothing in the app accidentally tries to query
// Meta Marketing API without credentials.

export async function isConnected(): Promise<boolean> {
  return false;
}
