const fs = require('fs');
const path = require('path');

async function exists(p) {
  try {
    await fs.promises.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src, dest) {
  await fs.promises.mkdir(dest, {recursive: true});
  // Node 16+ supports fs.promises.cp
  if (fs.promises.cp) {
    await fs.promises.cp(src, dest, {recursive: true});
    return;
  }
  // Fallback: manual copy
  const entries = await fs.promises.readdir(src, {withFileTypes: true});
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(s, d);
    }
  }
}

async function main() {
  const src = path.join(__dirname, '..', 'src', 'web', 'public');
  const dest = path.join(__dirname, '..', 'build', 'web', 'public');

  if (!(await exists(src))) {
    console.log('[copy-web-assets] No web assets found, skipping.');
    return;
  }
  await copyDir(src, dest);
  console.log('[copy-web-assets] Copied web assets to build/.');
}

main().catch(err => {
  console.error('[copy-web-assets] Failed:', err);
  process.exit(1);
});


