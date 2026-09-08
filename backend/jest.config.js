module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'js'],
  testMatch: ['**/tests/unit/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  preset: 'ts-jest',
}
