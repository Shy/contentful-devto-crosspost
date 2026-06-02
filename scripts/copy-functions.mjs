import { copyFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const functions = [
  {
    from: 'build/functions/createDevtoDraft.js',
    to: 'dist/functions/createDevtoDraft.js',
  },
];

for (const item of functions) {
  await mkdir(dirname(item.to), { recursive: true });
  await copyFile(item.from, item.to);
}
