module.exports = () => ({
  exclude: ['@nestjs/microservices', '@nestjs/websockets'],
  minify: false,
  resolveExtensions: ['.ts', '.js', '.mjs'],
  external: [],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  keepNames: true,
});
