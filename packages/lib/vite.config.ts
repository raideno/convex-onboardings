import { defineConfig } from "vite";

import compileTime from "vite-plugin-compile-time";
import dts from "vite-plugin-dts";
import tsconfigPaths from "vite-tsconfig-paths";

import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        server: "src/server.ts",
        schema: "src/schema.ts",
        client: "src/client.ts",
      },
      formats: ["es"],
    },
    outDir: "dist",
    target: "node18",
    sourcemap: false,
    minify: false,
    emptyOutDir: true,
    rollupOptions: {
      external: ["convex", "react", "react-dom"],
    },
  },
  plugins: [
    tsconfigPaths(),
    dts({
      rollupTypes: true,
      insertTypesEntry: true,
      tsconfigPath: "./tsconfig.json",
      outDir: "dist",
      entryRoot: "src",
      copyDtsFiles: true,
      include: ["src/**/*.ts", "src/**/*.tsx"],
    }),
    compileTime(),
    visualizer({
      filename: "stats.local.html",
      gzipSize: true,
      brotliSize: true,
      open: false,
    }),
  ],
});
