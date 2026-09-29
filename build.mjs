import { cp, mkdir, rm } from 'node:fs/promises';

const files = ['index.html', 'qa-profile-comparison.html', 'app.js', 'style.css', 'local.css', 'polish.css', 'product-campaign.png', 'assets'];
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
await Promise.all(files.map((file) => cp(file, `dist/${file}`, { recursive: true })));
console.log('Static production bundle created in dist/.');
