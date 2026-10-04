import { test, expect } from '@playwright/test';
import { existsSync } from 'fs';
import { join } from 'path';

// The backend started by tests/playwright.config.ts serves the built SPA from
// frontend/dist; when that directory has not been built yet, the static check of
// /api/health is legitimately degraded (503). The test asserts the real contract
// for both cases: JSON only, never the SPA HTML.
const DIST = join(__dirname, '..', '..', 'frontend', 'dist');
const DIST_BUILT = existsSync(join(DIST, 'index.html')) && existsSync(join(DIST, 'assets'));

test.describe('Health endpoint E2E (GET /api/health)', () => {
  test('answers JSON with status ok when the built SPA is present', async ({ request }) => {
    const res = await request.get('http://localhost:3000/api/health');

    expect(res.headers()['content-type']).toContain('application/json');
    expect(res.ok() || res.status() === 503).toBe(true);
    if (DIST_BUILT) {
      expect(res.status()).toBe(200);
    }

    const body = await res.json();
    expect(body.status).toBe(DIST_BUILT ? 'ok' : 'degraded');
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.uptimeSec).toBe('number');
    expect(body.version).toBeTruthy();

    expect(body.checks.db.ok).toBe(true);
    expect(body.checks.db.writable).toBe(true);
    expect(typeof body.checks.db.count).toBe('number');

    expect(body.checks.static.ok).toBe(DIST_BUILT);
    expect(body.checks.websocket.ok).toBe(true);
    expect(body.checks.websocket.path).toBe('/ws');
    expect(body.checks.runtime.ok).toBe(true);
    expect(body.checks.runtime.node).toBeTruthy();
    expect(body.checks.api.ok).toBe(true);
  });

  test('is not swallowed by the SPA catch-all (no HTML, no redirect)', async ({ request }) => {
    const res = await request.get('http://localhost:3000/api/health');
    const text = await res.text();

    expect(res.headers()['content-type']).toContain('application/json');
    expect(text.trim().startsWith('<')).toBe(false);
    expect(JSON.parse(text).checks).toBeTruthy();
  });

  test('the scores API still works next to the health route', async ({ request }) => {
    const scores = await request.get('http://localhost:3000/api/scores');
    expect(scores.status()).toBe(200);
    // gameRouter answers `{ scores: [...] }`, not a bare array.
    expect(Array.isArray((await scores.json()).scores)).toBe(true);

    const leaderboard = await request.get('http://localhost:3000/api/leaderboard');
    expect(leaderboard.status()).toBe(200);
    expect(Array.isArray((await leaderboard.json()).leaderboard)).toBe(true);

    const health = await request.get('http://localhost:3000/api/health');
    expect(health.status() === 200 || health.status() === 503).toBe(true);
  });
});
