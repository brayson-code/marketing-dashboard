# hyperframes-agent — Skills

## Tools available
- None directly in V1. Output is a structured script + storyboard that an external pipeline executes.

## Read access
- The brief KeyPlayer passes
- (Future: `hyperframes_render(prompt)` once HeyGen API is wired)
- (Future: `videouse_execute(plan)` for browser-use video editing)

## Write access
- **None directly.** Returns spec. Future: save to a `video_drafts` table when content schema gets extended.

## Out of scope
- Long-form video (>60s) — that needs a different agent
- Voiceover generation (TODO: wire a TTS tool)
- Music composition / licensing
- Posting to platforms (never auto-publish)
