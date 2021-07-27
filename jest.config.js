/** @type {import('@ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  collectCoverage: true,
  detectOpenHandles: true,
  "roots": [
    "./lib/tests"
  ],
  "testMatch": [
    "**/__tests__/**/*.+(ts|tsx|js)",
    "**/?(*.)+(spec|test).+(ts|tsx|js)"
  ],
  "transform": {
    "^.+\\.(ts|tsx)$": "ts-jest"
  },
}