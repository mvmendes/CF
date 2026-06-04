import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Caminho da skill relativo à raiz do repositório CF. */
export const SKILL_REPO_PATH = ".agents/skills/siga-automation";

const DEFAULT_REMOTE = "origin";
const DEFAULT_BRANCH = "main";

async function git(cwd, ...args) {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return (stdout || stderr || "").trim();
}

async function gitOk(cwd, ...args) {
  try {
    const out = await git(cwd, ...args);
    return { ok: true, out };
  } catch (e) {
    return {
      ok: false,
      error: e.stderr?.trim() || e.message || String(e),
    };
  }
}

/**
 * Sincroniza scripts/SKILL/config da skill com origin (sem alterar works/ nem sessão).
 * @param {object} opts
 * @param {boolean} [opts.force=false] — descarta alterações locais em ficheiros versionados da skill
 * @param {string} [opts.remote=origin]
 * @param {string} [opts.branch=main]
 */
export async function runPreflightSync(opts = {}) {
  const force = Boolean(opts.force);
  const remote = opts.remote || DEFAULT_REMOTE;
  const branch = opts.branch || DEFAULT_BRANCH;
  const skillDir = path.resolve(__dirname, "../..");
  const skillPathPosix = SKILL_REPO_PATH.replace(/\\/g, "/");

  const top = await gitOk(skillDir, "rev-parse", "--show-toplevel");
  if (!top.ok) {
    return {
      success: false,
      ok: false,
      skipped: true,
      reason: "not_a_git_repo",
      message:
        "Diretório da skill não está num clone git. Clone https://github.com/mvmendes/CF e use a pasta da skill dentro do repositório.",
      skillDir,
    };
  }

  const repoRoot = top.out;

  const fetch = await gitOk(repoRoot, "fetch", remote, branch);
  if (!fetch.ok) {
    return {
      success: false,
      ok: false,
      reason: "fetch_failed",
      message: fetch.error,
      remote,
      branch,
      repoRoot,
    };
  }

  const remoteRef = `${remote}/${branch}`;
  const localHead = await git(repoRoot, "rev-parse", "HEAD");
  const remoteHead = await git(repoRoot, "rev-parse", remoteRef);

  const behind = await git(
    repoRoot,
    "rev-list",
    "--count",
    `HEAD..${remoteRef}`,
    "--",
    skillPathPosix
  );
  const ahead = await git(
    repoRoot,
    "rev-list",
    "--count",
    `${remoteRef}..HEAD`,
    "--",
    skillPathPosix
  );

  const dirty = await git(
    repoRoot,
    "status",
    "--porcelain",
    "--",
    skillPathPosix
  );
  const dirtyLines = dirty
    ? dirty.split("\n").filter((l) => l.trim() && !l.includes("/works/"))
    : [];

  if (dirtyLines.length > 0 && !force) {
    return {
      success: false,
      ok: false,
      reason: "local_changes",
      message:
        "Há alterações locais na skill (fora de works/). Confirme com o analista ou execute preflight com --force=true após backup.",
      dirtyFiles: dirtyLines,
      remote,
      branch,
      remoteRef,
      localHead: localHead.slice(0, 12),
      remoteHead: remoteHead.slice(0, 12),
      behind: Number(behind),
      ahead: Number(ahead),
      repoRoot,
      skillDir,
    };
  }

  if (Number(behind) === 0) {
    return {
      success: true,
      ok: true,
      updated: false,
      message: "Skill já está alinhada com o remoto.",
      remote,
      branch,
      remoteRef,
      localHead: localHead.slice(0, 12),
      remoteHead: remoteHead.slice(0, 12),
      behind: 0,
      ahead: Number(ahead),
      repoRoot,
      skillDir,
      hint:
        Number(ahead) > 0
          ? "Existem commits locais na skill não enviados; abra um Pull Request para origin."
          : undefined,
    };
  }

  if (dirtyLines.length > 0 && force) {
    await git(repoRoot, "checkout", remoteRef, "--", skillPathPosix);
  } else {
    await git(repoRoot, "checkout", remoteRef, "--", skillPathPosix);
  }

  const newHead = await git(repoRoot, "rev-parse", remoteRef);

  return {
    success: true,
    ok: true,
    updated: true,
    message: `Skill atualizada a partir de ${remoteRef} (${behind} commit(s) na pasta da skill).`,
    remote,
    branch,
    remoteRef,
    commitsApplied: Number(behind),
    localHeadBefore: localHead.slice(0, 12),
    remoteHead: newHead.slice(0, 12),
    ahead: Number(ahead),
    force,
    repoRoot,
    skillDir,
    postStep:
      "Se package.json mudou, execute npm install na pasta da skill antes dos outros comandos.",
  };
}
