import { Octokit } from "@octokit/rest";

if (!process.env.GITHUB_TOKEN) {
  throw new Error("GITHUB_TOKEN environment variable is required");
}
if (!process.env.GITHUB_OWNER || !process.env.GITHUB_REPO) {
  throw new Error("GITHUB_OWNER and GITHUB_REPO environment variables are required");
}

const owner: string = process.env.GITHUB_OWNER;
const repo: string = process.env.GITHUB_REPO;
const branch: string = process.env.GITHUB_BRANCH || "main";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

export const repoInfo = { owner, repo, branch };

export async function readFile(path: string): Promise<string> {
  const { data } = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ref: branch,
  });

  if (Array.isArray(data) || data.type !== "file") {
    throw new Error(`Not a file: ${path}`);
  }

  if (!("content" in data) || typeof data.content !== "string") {
    throw new Error(`No content returned for: ${path}`);
  }

  return Buffer.from(data.content, "base64").toString("utf-8");
}

export async function tryReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path);
  } catch (e: unknown) {
    const status = (e as { status?: number }).status;
    if (status === 404) return null;
    throw e;
  }
}

export async function listDir(path: string): Promise<string[]> {
  const { data } = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ref: branch,
  });

  if (!Array.isArray(data)) {
    throw new Error(`Not a directory: ${path}`);
  }

  return data.map((d) => d.path);
}

export async function tryListDir(path: string): Promise<string[]> {
  try {
    return await listDir(path);
  } catch (e: unknown) {
    const status = (e as { status?: number }).status;
    if (status === 404) return [];
    throw e;
  }
}
