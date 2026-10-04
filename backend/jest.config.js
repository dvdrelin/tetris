module.exports = {
  // Explicit rootDir so the suite can also be run from the repository root
  // (`node node_modules/jest/bin/jest.js --config backend/jest.config.js`).
  rootDir: __dirname,
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', isolatedModules: true }],
  },
  moduleFileExtensions: ['ts', 'js'],
  testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
}
