import { redirect } from 'next/navigation';

// The legacy Automations page has been retired — its data sources were the old
// OpenClaw filesystem cron + `sequences` table. Scheduling now lives on the Cron
// board. Redirect any old links there.
export default function AutomationsRedirect() {
  redirect('/cron');
}
