// Single source of the app version: 2.{YY}.{MM}.{git short hash} — e.g. 2.26.11.85766f3.
// Major is bumped by hand (2 = the multiplayer MVP); YY/MM come from the build date (UTC,
// same as deploy.sh); the hash is `git rev-parse --short HEAD` of the checkout that builds.
// Resolution order: APP_VERSION env (deploy.sh → docker build arg → container ENV) wins;
// otherwise compute from git (dev server, local builds); 'dev' when git is unavailable
// (bare docker build without the arg) — so the UI/health never show an empty version.
const { execSync } = require('child_process')
const path = require('path')

const MAJOR = '2'

function gitShortHash(startCwd) {
  for (const dir of [startCwd, path.resolve(startCwd, '..')]) {
    try {
      return execSync('git rev-parse --short HEAD', { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch { /* not a worktree here — try the next candidate */ }
  }
  return 'dev'
}

function appVersion({ cwd = process.cwd(), env = process.env } = {}) {
  const fromEnv = (env.APP_VERSION || '').trim()
  if (fromEnv) return fromEnv
  const now = new Date()
  const yy = String(now.getUTCFullYear()).slice(-2)
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${MAJOR}.${yy}.${mm}.${gitShortHash(cwd)}`
}

module.exports = { appVersion, MAJOR }
