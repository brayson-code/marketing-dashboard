'use client';

import { CronBoard } from '@/components/cron/cron-board';
import { ActivateExecsBanner } from '@/components/cron/activate-execs-banner';
import { Explainer } from '@/components/ui/explainer';

export default function CronBoardPage() {
  return (
    <div className="space-y-6">
      <ActivateExecsBanner />
      <Explainer
        id="cron-intro"
        title="What schedules are"
        what="Work that runs on its own on a repeating schedule — a weekly summary, a daily inbox triage, a monthly report."
        when="Anything you have done more than twice belongs here."
        example="Every Monday at 8am, send a summary of last week."
        say={<>&ldquo;Every Monday at 8am, send me a summary of last week.&rdquo;</>}
      />
      <CronBoard variant="page" />
    </div>
  );
}
