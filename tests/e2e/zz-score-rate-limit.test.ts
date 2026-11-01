import { test, expect } from '@playwright/test';

/**
 * D1 (block 7): the public score endpoint is frequency-limited per IP.
 *
 * This file is intentionally named `zz-` so Playwright (workers: 1, files in alphabetical order)
 * runs it LAST: it deliberately exhausts the current window for this client, and a leftover 429
 * must not affect the rest of the suite.
 *
 * Honest by construction: the limit and window are read from /api/health instead of being
 * hard-coded, and previous consumption of the same window is measured first — so the test holds
 * whether or not earlier tests in this run already submitted scores.
 */
test.describe('Score rate limit (D1)', () => {
  test('POST /api/score answers 429 with Retry-After once the window is used up', async ({ request }) => {
    const health = await request.get('http://localhost:3000/api/health');
    expect(health.ok()).toBe(true);
    const posture = (await health.json()).checks.api.scoreRateLimit;
    expect(posture, 'health must report the score rate-limit posture').toBeTruthy();
    const { max, windowMs } = posture;
    expect(max).toBeGreaterThan(0);
    expect(windowMs).toBeGreaterThan(0);

    // Where the current window stands for this client.
    let consumed = 0;
    let probe = await request.post('http://localhost:3000/api/score', {
      data: { playerName: 'RateLimitProbe', score: 1 },
    });
    expect([200, 429]).toContain(probe.status());
    if (probe.status() === 200) consumed = max - Number(probe.headers()['x-ratelimit-remaining']);

    let firstLimitedAt = consumed;
    let limitedHeaders: Record<string, string> | null = null;
    for (let i = consumed; i < max + 10; i++) {
      const res = await request.post('http://localhost:3000/api/score', {
        data: { playerName: 'RateLimitProbe', score: 1 },
      });
      if (res.status() === 429) {
        firstLimitedAt = i + 1;
        limitedHeaders = res.headers();
        expect(Number(res.headers()['retry-after'])).toBeGreaterThan(0);
        expect((await res.json()).error).toBe('too many score submissions');
        break;
      }
      expect(res.status()).toBe(200);
    }
    expect(limitedHeaders, `no 429 within ${max + 10} submissions (limit ${max})`).toBeTruthy();
    expect(firstLimitedAt).toBeLessThanOrEqual(max + 1);

    // Once limited, the client stays limited for the rest of the window.
    for (let i = 0; i < 3; i++) {
      const res = await request.post('http://localhost:3000/api/score', {
        data: { playerName: 'RateLimitProbe', score: 1 },
      });
      expect(res.status()).toBe(429);
    }

    // Reads and the health endpoint are not throttled by this limiter.
    for (let i = 0; i < 5; i++) {
      expect((await request.get('http://localhost:3000/api/scores')).status()).toBe(200);
      expect((await request.get('http://localhost:3000/api/leaderboard')).status()).toBe(200);
      expect((await request.get('http://localhost:3000/api/health')).status()).toBe(200);
    }
  });
});
