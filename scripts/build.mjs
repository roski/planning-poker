import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
const output = await build({ entryPoints: ['src/app.js'], bundle: true, write: false, format: 'iife', target: ['es2022'], minify: true, legalComments: 'inline' });
const fontRoot = 'node_modules/@fontsource-variable/manrope/';
let fontCss = await readFile(`${fontRoot}index.css`, 'utf8');
for (const match of [...fontCss.matchAll(/url\(\.\/(files\/[^)]+)\)/g)]) {
  const font = await readFile(`${fontRoot}${match[1]}`);
  fontCss = fontCss.replace(match[0], `url(data:font/woff2;base64,${font.toString('base64')})`);
}
const css = fontCss + '\n' + await readFile('src/style.css', 'utf8');
const shell = await readFile('src/index.html', 'utf8');
const licenses = await readFile('THIRD_PARTY_LICENSES.txt', 'utf8') + '\n\nManrope Variable\n' + await readFile(`${fontRoot}LICENSE`, 'utf8');
const html = shell.replace('/* APP_STYLES */', css).replace('/* APP_SCRIPT */', output.outputFiles[0].text.replaceAll('</script', '<\\/script')).replace('THIRD_PARTY_NOTICES', licenses.replaceAll('--', '—'));
await writeFile('index.html', html);
console.log(`Built index.html (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB). No runtime downloads or build required to use this file.`);
