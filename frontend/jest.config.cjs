/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.tsx"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        isolatedModules: true,
        tsconfig: { jsx: "react-jsx", esModuleInterop: true, module: "commonjs" },
      },
    ],
  },
  snapshotSerializers: ["<rootDir>/src/components/__tests__/styleSerializer.cjs"],
};
