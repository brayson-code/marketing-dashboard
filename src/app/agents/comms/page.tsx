import { redirect } from 'next/navigation';

// The legacy Inbox / Agent Comms surface has been retired. Its contents moved:
//   - Agent-to-agent telemetry + Mission Control admin chat → /boardroom (tabs)
//   - YouTube + Instagram comment triage              → /engagement (tabs)
// This route stays alive so old bookmarks redirect cleanly instead of 404'ing.
// When AgentMail.to + Instantly.ai land, Inbox will be reborn as the email
// reply hub (different mental model from social-public Engagement).
export default function AgentCommsRedirect() {
  redirect('/boardroom');
}
