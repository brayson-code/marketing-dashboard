// Media-provider registry for the Hyperframes Canvas. Add a provider by creating a
// `MediaProvider` adapter (see nanobanana.ts / veo.ts) and registering it here.

import type { MediaKind, MediaProvider } from './types';
import { nanobanana } from './nanobanana';
import { veo } from './veo';

export type { MediaKind, MediaProvider, GenInput, SubmitResult, PollResult } from './types';

export const MEDIA_PROVIDERS: Record<string, MediaProvider> = {
  [nanobanana.id]: nanobanana,
  [veo.id]: veo,
};

export function getProvider(id: string): MediaProvider | null {
  return MEDIA_PROVIDERS[id] ?? null;
}

export function listProviders(): Array<{ id: string; label: string; kind: MediaKind }> {
  return Object.values(MEDIA_PROVIDERS).map((p) => ({ id: p.id, label: p.label, kind: p.kind }));
}
