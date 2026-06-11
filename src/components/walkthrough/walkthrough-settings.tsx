'use client';

import { useEffect } from 'react';
import { Compass, RotateCcw } from 'lucide-react';
import { useWalkthrough } from './store';

// Settings control for the setup walkthrough — the way back once it's been turned
// off (the in-app checklist hides itself when disabled). Toggle tips on/off and
// replay the whole walkthrough from scratch.
export function WalkthroughSettings() {
  const disabled = useWalkthrough((s) => s.disabled);
  const setDisabled = useWalkthrough((s) => s.setDisabled);
  const restart = useWalkthrough((s) => s.restart);

  useEffect(() => { void useWalkthrough.getState().hydrate(); }, []);

  return (
    <div className="panel p-5 space-y-3">
      <h2 className="text-sm font-medium flex items-center gap-2">
        <Compass size={14} className="text-primary" /> Setup walkthrough
      </h2>
      <p className="text-xs text-muted-foreground">
        Contextual setup tips and the &ldquo;Finish setup&rdquo; checklist that guides you through connecting your
        workspace. Shown to workspace owners.
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={!disabled} onChange={(e) => void setDisabled(!e.target.checked)} />
          Show setup tips
        </label>
        <button className="btn btn-ghost btn-sm" onClick={() => void restart()}>
          <RotateCcw size={13} /> Restart walkthrough
        </button>
      </div>
    </div>
  );
}
