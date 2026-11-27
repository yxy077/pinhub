import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const endpoint = new URL(process.env.PINHUB_API_ORIGIN || '');
if (endpoint.protocol !== 'https:' || endpoint.href !== endpoint.origin + '/') {
  throw new Error('PINHUB_API_ORIGIN must be a bare HTTPS origin');
}
const source = new URL('./public/', import.meta.url);
const output = new URL('./dist/pages/', import.meta.url);
await mkdir(output, { recursive: true });

const html = (await readFile(new URL('index.html', source), 'utf8'))
  .replace('  <title>', `  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' ${endpoint.origin}; object-src 'none'; base-uri 'none'">
  <title>`)
  .replace('href="/style.css"', 'href="./style.css"')
  .replace('<script defer src="/app.js"></script>',
    '<script defer src="./pinhub-config.js"></script>\n  <script defer src="./app.js"></script>')
  .replace('class="brand" href="/"', 'class="brand" href="./"');
const css = (await readFile(new URL('style.css', source), 'utf8')).replace('url("/food.jpg")', 'url("./food.jpg")');

await Promise.all([
  writeFile(new URL('index.html', output), html),
  writeFile(new URL('style.css', output), css),
  writeFile(new URL('pinhub-config.js', output), `window.PINHUB_API_ORIGIN = ${JSON.stringify(endpoint.origin)};\n`),
  copyFile(new URL('app.js', source), new URL('app.js', output)),
  copyFile(new URL('food.jpg', source), new URL('food.jpg', output))
]);
