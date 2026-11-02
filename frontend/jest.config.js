module.exports = {
  // Explicit rootDir so the suite can also be run from the repository root
  // (`node node_modules/jest/bin/jest.js --config frontend/jest.config.js`).
  rootDir: __dirname,
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', isolatedModules: true }],
  },
  moduleFileExtensions: ['ts', 'js'],
  // Workspace package: tests run against shared sources, not the backend-oriented dist.
  moduleNameMapper: {
    '^@neon-tetris/shared$': '<rootDir>/../shared/src/index.ts',
    '^@neon-tetris/shared/(.*)$': '<rootDir>/../shared/src/$1',
  },
  testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
}
