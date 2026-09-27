import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Builds the scene mock (src/mock) into dist-mock as one JS + one CSS file, to be inlined into an artifact page.
export default defineConfig({ plugins: [react()], root: "src/mock", base: "./", build: { outDir: "../../dist-mock", emptyOutDir: true, rollupOptions: { output: { inlineDynamicImports: true } } } });
