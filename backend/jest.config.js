module.exports = {
  // Explicit rootDir so the suite can also be run from the repository root
  // (`node node_modules/jest/bin/jest.js --config backend/jest.config.js`).
  rootDir: __dirname,
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', isolatedModules: true }],
  },
  moduleFileExtensions: ['ts', 'js'],
  // Same as the frontend suite: the engine is exercised from shared sources, so backend
  // unit tests do not depend on shared/dist being built.
  moduleNameMapper: {
    '^@neon-tetris/shared$': '<rootDir>/../shared/src/index.ts',
    '^@neon-tetris/shared/(.*)$': '<rootDir>/../shared/src/$1',
  },
  testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
}
