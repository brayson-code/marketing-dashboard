'use client';

import { CronBoard } from '@/components/cron/cron-board';
import { ActivateExecsBanner } from '@/components/cron/activate-execs-banner';

export default function CronBoardPage() {
  return (
    <div className="space-y-6">
      <ActivateExecsBanner />
      <CronBoard variant="page" />
    </div>
  );
}
