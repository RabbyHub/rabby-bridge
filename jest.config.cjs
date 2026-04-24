module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  transform: {},
  moduleNameMapper: {
    '^@debank/common$': '<rootDir>/tests/mocks/debank-common.js',
  },
};
