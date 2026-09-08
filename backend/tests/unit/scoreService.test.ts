import * as fs from 'fs';
import * as path from 'path';
import { ScoreService } from '../../src/services/scoreService';

const TEST_DB_DIR = path.join(__dirname, '..', 'data');
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'scores.json');

// Ensure test db dir exists
if (!fs.existsSync(TEST_DB_DIR)) {
  fs.mkdirSync(TEST_DB_DIR, { recursive: true });
}

// Clear test DB before each test
beforeEach(() => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch (e) { /* ignore */ }
});

describe('ScoreService', () => {
  let service: ScoreService;

  beforeEach(() => {
    // Pass test DB path via constructor option
    service = new ScoreService({ dbPath: TEST_DB_PATH });
  });

  test('should save and retrieve score', () => {
    service.saveScore('TestPlayer', 1000, 0, 5, 10);
    const scores = service.getTopScores(-1, 10);
    expect(scores).toHaveLength(1);
    expect(scores[0].player_name).toBe('TestPlayer');
    expect(scores[0].score).toBe(1000);
  });

  test('should sort scores by score descending', () => {
    service.saveScore('PlayerA', 500, 0, 3, 5);
    service.saveScore('PlayerB', 1500, 0, 7, 15);
    service.saveScore('PlayerC', 1000, 0, 5, 10);
    
    const scores = service.getTopScores(-1, 10);
    expect(scores[0].score).toBe(1500);
    expect(scores[1].score).toBe(1000);
    expect(scores[2].score).toBe(500);
  });

  test('should filter by mode', () => {
    service.saveScore('PlayerA', 500, 0, 3, 5);
    service.saveScore('PlayerB', 1500, 1, 7, 15);
    service.saveScore('PlayerC', 1000, 0, 5, 10);
    
    const arcadeScores = service.getTopScores(0);
    expect(arcadeScores.length).toBe(2);
    expect(arcadeScores.every((s: any) => s.mode === 0)).toBe(true);
    
    const hardcoreScores = service.getTopScores(1);
    expect(hardcoreScores.length).toBe(1);
    expect(hardcoreScores[0].player_name).toBe('PlayerB');
  });

  test('should limit results', () => {
    for (let i = 0; i < 10; i++) {
      service.saveScore(`Player${i}`, i * 100, 0, i, i * 5);
    }
    const scores = service.getTopScores(-1, 5);
    expect(scores.length).toBe(5);
  });

  test('should get leaderboard', () => {
    service.saveScore('Alice', 1000, 0, 5, 10);
    service.saveScore('Alice', 2000, 0, 7, 15);
    service.saveScore('Bob', 1500, 0, 6, 12);
    
    const leaderboard = service.getLeaderboard(-1);
    expect(leaderboard.length).toBe(2);
    
    const aliceEntry = leaderboard.find((e: any) => e.player === 'Alice');
    expect(aliceEntry).toBeDefined();
    if (aliceEntry) {
      expect(aliceEntry.games).toBe(2);
      expect(aliceEntry.totalScore).toBe(3000);
      expect(aliceEntry.highScore).toBe(2000);
    }
  });

  test('should get player stats', () => {
    service.saveScore('TestPlayer', 500, 0, 3, 5);
    service.saveScore('TestPlayer', 1500, 0, 7, 15);
    
    const stats = service.getPlayerStats('TestPlayer');
    expect(stats.games).toBe(2);
    expect(stats.highScore).toBe(1500);
    expect(stats.totalScore).toBe(2000);
    expect(stats.averageScore).toBe(1000);
  });

  test('should return empty stats for unknown player', () => {
    const stats = service.getPlayerStats('NoPlayer');
    expect(stats.games).toBe(0);
    expect(stats.highScore).toBe(0);
    expect(stats.totalScore).toBe(0);
    expect(stats.averageScore).toBe(0);
  });

  test('should get player scores', () => {
    service.saveScore('TestPlayer', 500, 0, 3, 5);
    service.saveScore('TestPlayer', 1500, 0, 7, 15);
    service.saveScore('TestPlayer', 1000, 0, 5, 10);
    
    const scores = service.getPlayerScores('TestPlayer', 2);
    expect(scores.length).toBe(2);
    expect(scores[0].score).toBe(1500);
    expect(scores[1].score).toBe(1000);
  });

  test('should handle empty scores', () => {
    const service2 = new ScoreService({ dbPath: TEST_DB_PATH });
    const scores = service2.getTopScores(-1, 10);
    expect(scores.length).toBe(0);
    
    const leaderboard = service2.getLeaderboard(-1);
    expect(leaderboard.length).toBe(0);
  });
});
