// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

function shouldIgnoreLog(entry?: { code?: string; message?: string }): boolean {
  return Boolean(
    entry?.code === "MODULE_LEVEL_DIRECTIVE" || entry?.message?.includes('directive "use client"'),
  );
}

function esmDirnameFixPlugin(): Plugin {
  const dirnameExpr =
    '(typeof import.meta !== "undefined" && import.meta.dirname ? import.meta.dirname : (typeof process !== "undefined" ? process.cwd() : "."))';
  const filenameExpr =
    '(typeof import.meta !== "undefined" && import.meta.filename ? import.meta.filename : "")';
  const dirnamePattern = /(?<![.$\w])__dirname\b/g;
  const filenamePattern = /(?<![.$\w])__filename\b/g;

  return {
    name: "sace-esm-dirname-fix",
    apply: "build",
    enforce: "post",
    renderChunk(code, chunk) {
      if (this.environment?.config?.consumer !== "server") return null;
      if (chunk.fileName.endsWith(".css")) return null;
      if (!code.includes("__dirname") && !code.includes("__filename")) return null;
      const updated = code
        .replace(dirnamePattern, dirnameExpr)
        .replace(filenamePattern, filenameExpr);
      if (updated === code) return null;
      return { code: updated, map: null };
    },
  };
}

export default defineConfig({
  nitro: {
    preset: "node-server",
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    client: { entry: "client" },
  },
  vite: {
    plugins: [esmDirnameFixPlugin()],
    server: {
      host: "0.0.0.0",
      port: 3000,
      allowedHosts: true,
      watch: {
        ignored: ["**/.data/**", "**/.sace-uploads/**"],
      },
    },
    build: {
      rolldownOptions: {
        onLog(level, log, defaultHandler) {
          if (shouldIgnoreLog(log)) return;
          defaultHandler(level, log);
        },
        onwarn(warning, defaultHandler) {
          if (shouldIgnoreLog(warning)) return;
          defaultHandler(warning);
        },
      },
    },
  },
});
