import { build } from 'esbuild';

await build({
  entryPoints: ['src/lambda.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/lambda.mjs',
  banner: {
    // esbuild's ESM output doesn't define require/import.meta.url shims some deps expect.
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);"
  },
  // Keep AWS SDK v3 external: it's provided by the Lambda Node.js runtime for
  // @aws-sdk/* v3 clients in newer runtimes, and bundling it is unnecessary bloat.
  // We still bundle it here for portability across runtimes that may lag behind
  // (safer for a hackathon deploy) — flip to `external` if cold start size matters.
  minify: true,
  sourcemap: true,
  logLevel: 'info'
});
