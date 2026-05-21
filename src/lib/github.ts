// Minimal GitHub REST client (no octokit) for the Fixer agent. Opens a real PR
// without a git checkout: read a file, branch, commit file(s), open a draft PR.
//
// Fork-aware: when GITHUB_FORK_REPO is set, the Fixer COMMITS to your fork (which
// you have write on) and opens a cross-fork PR back to the upstream GITHUB_REPO.
// This lets a read-only collaborator contribute fixes to a public upstream.
//
// Config (server-side):
//   GITHUB_TOKEN          PAT with write on the write-repo + ability to open PRs
//   GITHUB_REPO           upstream "owner/repo" = PR base (default builderz-labs/marketing-dashboard)
//   GITHUB_FORK_REPO      optional "owner/repo" you can write to (the fork)
//   GITHUB_DEFAULT_BRANCH base branch (default "main")

const API = 'https://api.github.com';

/** Upstream repo — the PR base / source of truth for reads. */
function upstreamRepo(): string {
  return process.env.GITHUB_REPO || 'builderz-labs/marketing-dashboard';
}
/** Where we commit (the fork if configured, else upstream). */
export function writeRepo(): string {
  return process.env.GITHUB_FORK_REPO || upstreamRepo();
}
function isCrossFork(): boolean {
  return writeRepo() !== upstreamRepo();
}
export function defaultBranch(): string {
  return process.env.GITHUB_DEFAULT_BRANCH || 'main';
}
export function isGitHubConfigured(): boolean {
  return !!process.env.GITHUB_TOKEN;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'keyplayers-keywatch',
  };
}

async function gh<T>(method: string, repoSlug: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/repos/${repoSlug}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${method} ${repoSlug}${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export interface RepoFile { text: string; sha: string }

/** Read a file's text + blob sha at a ref. Defaults to the upstream repo. Returns null on 404. */
export async function getFileContent(path: string, ref?: string, repoSlug: string = upstreamRepo()): Promise<RepoFile | null> {
  const clean = path.replace(/^\/+/, '');
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const res = await fetch(`${API}/repos/${repoSlug}/contents/${encodeURIComponent(clean).replace(/%2F/g, '/')}${q}`, {
    headers: headers(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub get contents ${clean} → ${res.status}`);
  const json = (await res.json()) as { content?: string; encoding?: string; sha: string; type: string };
  if (json.type !== 'file' || typeof json.content !== 'string') return null;
  const text = Buffer.from(json.content, (json.encoding as BufferEncoding) || 'base64').toString('utf-8');
  return { text, sha: json.sha };
}

async function getBranchSha(branch: string, repoSlug: string): Promise<string> {
  const ref = await gh<{ object: { sha: string } }>('GET', repoSlug, `/git/ref/heads/${encodeURIComponent(branch)}`);
  return ref.object.sha;
}

/** Create a branch on the WRITE repo (the fork, if configured). */
export async function createBranch(newBranch: string, fromBranch = defaultBranch()): Promise<void> {
  const sha = await getBranchSha(fromBranch, writeRepo());
  await gh('POST', writeRepo(), '/git/refs', { ref: `refs/heads/${newBranch}`, sha });
}

/** Create or update a file on a branch in the WRITE repo. Pass the blob sha to update. */
export async function putFile(path: string, contentText: string, branch: string, message: string, sha?: string): Promise<void> {
  const clean = path.replace(/^\/+/, '');
  await gh('PUT', writeRepo(), `/contents/${encodeURIComponent(clean).replace(/%2F/g, '/')}`, {
    message,
    content: Buffer.from(contentText, 'utf-8').toString('base64'),
    branch,
    ...(sha ? { sha } : {}),
  });
}

export interface OpenedPR { url: string; number: number }

/** Open a PR on the UPSTREAM repo. For a cross-fork setup, head is qualified as "forkOwner:branch". */
export async function openPullRequest(opts: { head: string; base?: string; title: string; body: string; draft?: boolean }): Promise<OpenedPR> {
  const head = isCrossFork() ? `${writeRepo().split('/')[0]}:${opts.head}` : opts.head;
  const pr = await gh<{ html_url: string; number: number }>('POST', upstreamRepo(), '/pulls', {
    title: opts.title,
    head,
    base: opts.base ?? defaultBranch(),
    body: opts.body,
    draft: opts.draft ?? true,
  });
  return { url: pr.html_url, number: pr.number };
}
