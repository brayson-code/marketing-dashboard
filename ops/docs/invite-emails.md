# Invite Emails

When you invite someone to KeyCommand — a client into their own workspace, or a teammate into yours — the app creates their account, generates a **one-time sign-in link**, and tries to **email it to them automatically**.

If no email provider is configured, nothing breaks: the invite still works, and the app shows you the sign-in link to copy and send yourself, with a note that the email wasn't sent.

---

## How invites work

There are two kinds of invite:

| Invite | Where | What happens |
|--------|-------|--------------|
| **Client** | Clients page (platform owner only) | Creates a brand-new, isolated workspace with its own AI team and data, makes the client its owner, and invites them in. |
| **Teammate** | Onboarding wizard / Settings | Adds a person to **your existing** workspace — they see the same dashboard you do. |

In both cases the invitee gets a link that signs them in once and asks them to set a password. After that they log in normally. The link is single-use; if it expires before they use it, just invite them again to generate a fresh one.

After sending an invite, the app tells you exactly what happened:

- **"Invite emailed ✓"** — the email went out; you don't need to do anything.
- **"Email not configured — copy this link"** — no email provider is set up, so copy the link shown and send it to them over whatever channel you like (iMessage, Slack, carrier pigeon).

One rule to know: an email address can only belong to **one** workspace. If you invite someone who already has a workspace elsewhere, the invite is refused with a clear message rather than silently moving them.

---

## Enabling real email sending

Invites try two senders, in order. Configure either one and invite emails start flowing — no code changes needed.

### Option 1: Resend (recommended)

1. Create a free account at [resend.com](https://resend.com) and generate an API key.
2. In your Vercel project, add the environment variable `RESEND_API_KEY` with that key.
3. Optionally add `RESEND_FROM` (e.g. `KeyPlayers <invites@yourdomain.com>`) — you'll need to verify the domain in Resend first. Without it, invites send from Resend's shared onboarding address, which works but looks less polished.
4. Redeploy. Done.

### Option 2: AgentMail (uses your existing email-agent account)

If the platform (HQ) workspace already has an [AgentMail](https://agentmail.to) key pasted on its **Connections** page, invites will send from the HQ account's first inbox — no extra setup. This is the fallback when Resend isn't configured.

### Neither configured?

Everything still works. Invites are created normally; you just play postman — the UI hands you the sign-in link to share manually and says so honestly.

---

## Troubleshooting

- **The invitee never got the email.** Check spam first. Then re-invite them — a fresh link is generated and emailed each time, and the UI will tell you whether the send succeeded.
- **"That email already belongs to a different workspace."** Each account lives in exactly one workspace today. Use a different email address, or remove them from the other workspace first.
- **The link says it's expired.** Sign-in links are one-time and time-limited. Send a new invite to the same address — it reuses their account and just mints a new link.
