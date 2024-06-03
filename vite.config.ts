import { join, resolve } from 'path';
import { defineConfig } from 'vitest/config';
import terser from '@rollup/plugin-terser';

const EXTENSIONS: Record<string, string> = {
  es: 'mjs',
  cjs: 'cjs',
};

export default defineConfig(({ mode }) => {
  if (mode === 'cli') {
    return {
      build: {
        emptyOutDir: false,
        sourcemap: false,
        minify: false,
        lib: {
          entry: 'src/cli.ts',
          formats: ['es'],
          fileName: () => 'cli.mjs',
        },
        rollupOptions: {
          external: ['path', 'fs', './index'],
          output: {
            paths: {
              [resolve('./src/index')]: './es/index.mjs'
            }
          }
        },
      },
    };
  }

  return {
    build: {
      emptyOutDir: !process.env.MINIFY,
      sourcemap: !!process.env.MINIFY,
      minify: !!process.env.MINIFY,
      lib: {
        entry: 'src/',
        name: 'JSON11',
        formats: ['umd', 'cjs', 'es'],
        fileName: (format) => {
          return join(format, `index${process.env.MINIFY ? '.min' : ''}.${EXTENSIONS[format] || 'js'}`);
        },
      },
      rollupOptions: {
        external: ['path', 'fs'],
        plugins: [
          process.env.MINIFY
            ? terser({
              ecma: 2020,
            })
            : undefined,
        ],
      },
    },
    test: {
      coverage: {
        provider: 'istanbul',
        reporter: ['text', 'html'],
        reportsDirectory: './.coverage',
        include: ['src/**/*.ts'],
        exclude: ['src/cli.ts'],
      },
    },
  };
});
