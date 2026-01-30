import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["index.ts", "client.ts"],
	format: ["cjs", "esm"],
	dts: true,
	splitting: false,
	sourcemap: true,
	clean: true,
});
