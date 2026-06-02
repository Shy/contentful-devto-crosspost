module.exports = {
  entryPoints: {
    'functions/createDevtoDraft': './functions/createDevtoDraft.ts',
  },
  bundle: true,
  outdir: 'build',
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  minify: true,
  logLevel: 'info',
};
