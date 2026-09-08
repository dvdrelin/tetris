module.exports = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'js'],
  testMatch: ['**/tests/unit/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  preset: 'ts-jest',
  globals: {
    'ts-jest': {
      tsconfig: './tsconfig.json',
      isolatedModules: true,
    },
  },
}
