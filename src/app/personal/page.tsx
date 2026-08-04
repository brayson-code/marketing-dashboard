import { Heart } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Explainer } from '@/components/ui/explainer';

// Personal Life — placeholder. One of the six North Star sections with no
// surfaces built yet. Stated plainly rather than hidden, so the structure the
// assistant is trained on matches the structure they see. Replace the checklist
// below with the real surfaces as they land.

const SECTIONS: ReadonlyArray<{ title: string; items: string }> = [
  { title: 'Travel', items: 'Flights, hotels, itineraries, reservations' },
  { title: 'Dates that matter', items: 'Birthdays, anniversaries, gifts, gift history' },
  { title: 'Family & household', items: 'Family logistics, appointments, household responsibilities' },
  { title: 'Health & routine', items: 'Health reminders, standing appointments, routines' },
  { title: 'Errands', items: 'Purchases, personal research, events' },
];

export default function PersonalLifePage() {
  return (
    <div className="space-y-4 animate-in">
      <PageHeader
        icon={<Heart size={20} />}
        title="Personal Life"
        subtitle="The personal side of the founder's life the assistant helps carry."
      />

      <Explainer
        id="personal-life-intro"
        title="What this section is for"
        what="The personal responsibilities an assistant takes off the founder's plate — travel, appointments, gifts, family logistics, errands."
        when="Use it for anything that isn't company work but still eats the founder's attention."
        example="Booking a flight, remembering a partner's birthday, arranging a dinner reservation before a trip."
      />

      <div className="panel p-4 space-y-3">
        <p className="text-small">
          This section is being built. It will hold:
        </p>
        <ul className="space-y-2">
          {SECTIONS.map((s) => (
            <li key={s.title} className="text-xs">
              <span className="font-medium text-foreground/90">{s.title}</span>
              <span className="text-muted-foreground"> — {s.items}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
