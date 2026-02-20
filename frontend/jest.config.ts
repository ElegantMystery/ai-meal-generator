import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

const config: Config = {
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  testMatch: ["**/__tests__/**/*.test.{ts,tsx}"],
  coverageProvider: "v8",
  collectCoverageFrom: ["lib/**/*.ts", "components/ui/**/*.tsx", "!**/*.d.ts"],
};

export default createJestConfig(config);
