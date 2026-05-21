// Minimal GitHub REST client (no octokit dependency) for the Fixer agent.
// Lets a serverless function open a real PR without a git checkout: read a file,
// branch off the default branch, commit updated file(s), and open a draft PR.
//
// Config (all server-side secrets):
//   GITHUB_TOKEN          fine-grained PAT or app token with contents:write + pull_requests:write
//   GITHUB_REPO           "owner/repo" (defaults to this repo)
//   GITHUB_DEFAULT_BRANCH base branch for PRs (default "main")

const API = 'https://api.github.com';

function repo(): string {
  return process.env.GITHUB_REPO || 'builderz-labs/marketing-dashboard';
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

async function gh<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/repos/${repo()}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export interface RepoFile { text: string; sha: string }

/** Read a file's text + blob sha at a ref. Returns null on 404. */
export async function getFileContent(path: string, ref?: string): Promise<RepoFile | null> {
  const clean = path.replace(/^\/+/, '');
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const res = await fetch(`${API}/repos/${repo()}/contents/${encodeURIComponent(clean).replace(/%2F/g, '/')}${q}`, {
    headers: headers(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub get contents ${clean} → ${res.status}`);
  const json = (await res.json()) as { content?: string; encoding?: string; sha: string; type: string };
  if (json.type !== 'file' || typeof json.content !== 'string') return null;
  const text = Buffer.from(json.content, (json.encoding as BufferEncoding) || 'base64').toString('utf-8');
  return { text, sha: json.sha };
}

async function getBranchSha(branch: string): Promise<string> {
  const ref = await gh<{ object: { sha: string } }>('GET', `/git/ref/heads/${encodeURIComponent(branch)}`);
  return ref.object.sha;
}

export async function createBranch(newBranch: string, fromBranch = defaultBranch()): Promise<void> {
  const sha = await getBranchSha(fromBranch);
  await gh('POST', '/git/refs', { ref: `refs/heads/${newBranch}`, sha });
}

/** Create or update a file on a branch. Pass the existing blob sha to update. */
export async function putFile(
  path: string,
  contentText: string,
  branch: string,
  message: string,
  sha?: string,
): Promise<void> {
  const clean = path.replace(/^\/+/, '');
  await gh('PUT', `/contents/${encodeURIComponent(clean).replace(/%2F/g, '/')}`, {
    message,
    content: Buffer.from(contentText, 'utf-8').toString('base64'),
    branch,
    ...(sha ? { sha } : {}),
  });
}

export interface OpenedPR { url: string; number: number }

export async function openPullRequest(opts: {
  head: string;
  base?: string;
  title: string;
  body: string;
  draft?: boolean;
}): Promise<OpenedPR> {
  const pr = await gh<{ html_url: string; number: number }>('POST', '/pulls', {
    title: opts.title,
    head: opts.head,
    base: opts.base ?? defaultBranch(),
    body: opts.body,
    draft: opts.draft ?? true,
  });
  return { url: pr.html_url, number: pr.number };
}
