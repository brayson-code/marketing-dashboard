import { UserRound } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Explainer } from '@/components/ui/explainer';

// Founder Profile — placeholder. The nav is organised around the six North Star
// sections; this one has no surfaces built yet, so the page states plainly what
// will live here rather than 404ing or hiding the section. Replace the checklist
// below with the real profile surfaces as they land.

const SECTIONS: ReadonlyArray<{ title: string; items: string }> = [
  { title: 'How they work', items: 'Communication preferences, decision-making style, working hours, writing style' },
  { title: 'Boundaries', items: 'Approval limits, escalation rules, what never gets delegated' },
  { title: 'Context', items: 'Biography, values, important relationships, family context' },
  { title: 'Preferences', items: 'Travel preferences, health routines, personal standing orders' },
];

export default function FounderProfilePage() {
  return (
    <div className="space-y-4 animate-in">
      <PageHeader
        icon={<UserRound size={20} />}
        title="Founder Profile"
        subtitle="Everything an assistant needs to know about how this founder works."
      />

      <Explainer
        id="founder-profile-intro"
        title="What this section is for"
        what="The single place that describes how the founder works, decides, and communicates — so the assistant never has to ask twice."
        when="Fill it in during onboarding, then update it whenever you learn something new about how they like things done."
        example="“Never book meetings before 9am.” “Always confirm travel by text, not email.”"
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
