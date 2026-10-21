import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { decodePng, escapeHtml, NOISE, pairScreens, pixelDifference } from './screens-model.mjs';

export function htmlShell(title, body, script = '') {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font:16px system-ui;background:#151923;color:#edf0f7;margin:24px}a{color:#9cc9ff}h1{font-size:26px}h2{font-size:18px}article{margin:32px 0;padding:16px;background:#202633;border-radius:8px}.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}figure{margin:0}img,canvas{width:100%;height:auto;background:#fff}figcaption{margin-bottom:8px}nav{display:flex;flex-wrap:wrap;gap:12px}p{max-width:90ch}</style>
${body}${script ? `<script>${script}</script>` : ''}</html>`;
}
export async function comparison(beforeDir, output, currentNames) {
  const beforeNames = (await readdir(beforeDir)).filter(name => /^[a-z0-9-]+\.png$/.test(name));
  const rows = [], sections = [];
  for (const pair of pairScreens(beforeNames, currentNames)) {
    const before = pair.status !== 'new' ? await readFile(path.join(beforeDir, pair.name)) : null;
    const after = pair.status !== 'missing' ? await readFile(path.join(output, pair.name)) : null;
    // Identical lossless files imply identical pixels. Most stable fixtures take
    // this path; changed encodings still use the documented pixel/noise model.
    const difference = before && after ? before.equals(after)
      ? { changed: false, dimensionsChanged: false, changedPixels: 0, fraction: 0 }
      : pixelDifference(decodePng(before), decodePng(after), NOISE) : null;
    const status = difference ? (difference.changed ? 'changed' : 'unchanged') : pair.status;
    rows.push({ name: pair.name, status, ...(difference ?? {}) });
    if (status === 'unchanged') continue;
    const image = (bytes, label) => bytes ? `<figure><figcaption>${label}</figcaption><img loading="lazy" decoding="async" alt="${label}" src="data:image/png;base64,${bytes.toString('base64')}"></figure>` : `<figure><figcaption>${label}: absent</figcaption></figure>`;
    sections.push(`<article data-status="${status}"><h2>${escapeHtml(pair.name)} · ${status}</h2>${difference ? `<p>${difference.dimensionsChanged ? 'Image dimensions changed.' : `${(difference.fraction * 100).toFixed(3)}% pixels exceed channel delta ${NOISE.channelDelta}.`}</p>` : ''}<div class="shots">${image(before, 'Before')}${image(after, 'After')}${before && after ? '<figure><figcaption>Pixel difference (pink = changed; gray = retained)</figcaption><canvas></canvas></figure>' : ''}</div></article>`);
  }
  const counts = Object.fromEntries(['changed', 'new', 'missing', 'unchanged'].map(status => [status, rows.filter(row => row.status === status).length]));
  const script = `const noise=${JSON.stringify(NOISE)};
async function pixels(image){await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);return {width:canvas.width,height:canvas.height,pixels:context.getImageData(0,0,canvas.width,canvas.height).data};}
const observer=new IntersectionObserver(entries=>{for(const entry of entries){const article=entry.target,canvas=article.querySelector('canvas');if(!canvas)continue;if(!entry.isIntersecting){canvas.dataset.visible='false';canvas.width=canvas.height=1;delete canvas.dataset.ready;continue;}canvas.dataset.visible='true';if(canvas.dataset.busy||canvas.dataset.ready)continue;canvas.dataset.busy='true';Promise.all([...article.querySelectorAll('img')].map(pixels)).then(([before,after])=>{if(canvas.dataset.visible!=='true')return;canvas.width=Math.max(before.width,after.width);canvas.height=Math.max(before.height,after.height);canvas.style.aspectRatio=canvas.width+'/'+canvas.height;const context=canvas.getContext('2d'),result=context.createImageData(canvas.width,canvas.height);for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const p=(y*canvas.width+x)*4,a=(y*before.width+x)*4,b=(y*after.width+x)*4,missing=x>=before.width||y>=before.height||x>=after.width||y>=after.height;const changed=missing||[0,1,2,3].some(c=>Math.abs(before.pixels[a+c]-after.pixels[b+c])>noise.channelDelta);const gray=missing?25:Math.round((after.pixels[b]+after.pixels[b+1]+after.pixels[b+2])/6);result.data.set(changed?[255,40,130,255]:[gray,gray,gray,255],p);}context.putImageData(result,0,0);canvas.dataset.ready='true';}).catch(()=>{canvas.replaceWith(document.createTextNode('Diff image unavailable.'));}).finally(()=>{delete canvas.dataset.busy;});}},{rootMargin:'300px'});for(const article of document.querySelectorAll('article'))if(article.querySelector('canvas'))observer.observe(article);`;
  await writeFile(path.join(output, 'compare.html'), htmlShell('Screenshot comparison', `<h1>Screenshot comparison</h1><p><a href="index.html">Current gallery</a></p><p>${Object.entries(counts).map(([key, value]) => `${value} ${key}`).join(' · ')}.</p><p>Noise tolerance: per-channel differences ≤8 ignored; images count as changed above 0.1% affected pixels. Dimensions always count as changed. Date text and copied-save changes can still produce expected differences.</p>${sections.join('\n') || '<p>No changes exceed the tolerance.</p>'}`, script));
  return { counts, noise: NOISE, rows };
}

