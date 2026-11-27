import { mkdir, readFile, writeFile } from 'node:fs/promises';

const files = [
  ['/', 'index.html', 'text/html; charset=utf-8'],
  ['/style.css', 'style.css', 'text/css; charset=utf-8'],
  ['/app.js', 'app.js', 'text/javascript; charset=utf-8'],
  ['/food.jpg', 'food.jpg', 'image/jpeg']
];

const assets = Object.fromEntries(await Promise.all(files.map(async ([route, name, type]) => {
  const source = await readFile(new URL('./public/' + name, import.meta.url));
  return [route, [type, source.toString('base64')]];
})));
const shared = await readFile(new URL('./domain.cjs', import.meta.url), 'utf8');
const worker = await readFile(new URL('./worker.mjs', import.meta.url), 'utf8');
const manifest = await readFile(new URL('./.openai/hosting.json', import.meta.url), 'utf8');
const source = `const assets = ${JSON.stringify(assets)};
const domain = (() => {
  const module = { exports: {} };
${shared}
  return module.exports;
})();
${worker}`;
for (const folder of ['dist/server/', 'dist/.openai/']) {
  await mkdir(new URL('./' + folder, import.meta.url), { recursive: true });
}
await writeFile(new URL('./dist/server/index.js', import.meta.url), source);
await writeFile(new URL('./dist/.openai/hosting.json', import.meta.url), manifest);
