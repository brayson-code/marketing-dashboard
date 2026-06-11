import { redirect } from 'next/navigation';

// The old "Connect" tab was merged into /connections. Redirect any old links /
// bookmarks to the combined page (which renders the API-key integrations grid as
// its second section).
export default function IntegrationsSetupRedirect() {
  redirect('/connections');
}
