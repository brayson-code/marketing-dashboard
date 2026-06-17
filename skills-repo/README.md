# KeyPlayers Agent Skills

This is the source-of-truth catalog for the **Skill Library** in the KeyPlayers
Command Center (`/agents/skills`). Each skill is a markdown file; `manifest.json`
lists them. The app syncs from here when an HQ admin clicks **Sync from GitHub**.

## How to publish it

1. Create a GitHub repo (public is simplest), e.g. `keyplayershq/agent-skills`.
2. Copy the contents of this `skills-repo/` folder to the repo root and push to `main`.
3. In the Command Center, set the env var **`SKILLS_GITHUB_REPO=keyplayershq/agent-skills`**
   (and optionally `SKILLS_GITHUB_BRANCH`, default `main`).
4. Go to **Agents → Skills → Sync from GitHub**. The catalog updates from `manifest.json`.

## Structure

```
manifest.json          # the catalog index (array of skills)
skills/<slug>.md       # one markdown file per skill = the skill's instructions
```

## manifest.json format

```json
[
  { "slug": "cold-email-opener", "name": "Cold Email Opener", "category": "outreach",
    "description": "One-line summary shown on the card.", "file": "skills/cold-email-opener.md" }
]
```

- `slug` — unique id (lowercase, hyphens). Re-syncing updates the skill with this slug.
- `file` — path to the markdown body, relative to the repo root.

## Writing a good skill

Keep the body as **direct instructions to an agent** — plain imperative prose, no
preamble. It gets appended to the agent's instructions verbatim, so write it the way
you'd brief a teammate: what to do, the rules, and what "good" looks like.
