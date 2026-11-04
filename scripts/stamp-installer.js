'use strict';

// Stamp the extension version into the remote installer's default git ref.
// Run before build/release so `irm .../v<version>/install-ct2-server.ps1`
// points at a real tag instead of a stale one.

const fs = require('fs');
const path = require('path');

const packageJson = require('../package.json');
const scriptPath = path.join(__dirname, 'install-ct2-server.ps1');
const version = String(packageJson.version || '').trim();
if (!version) {
  throw new Error('package.json has no version.');
}

const source = fs.readFileSync(scriptPath, 'utf8');
const pattern = /^\$DefaultRef = 'v[^']*'$/m;
if (!pattern.test(source)) {
  throw new Error(
    'Could not find the $DefaultRef line in scripts/install-ct2-server.ps1.',
  );
}
const next = source.replace(pattern, `$DefaultRef = 'v${version}'`);
if (next !== source) {
  fs.writeFileSync(scriptPath, next);
  console.log(`Stamped installer ref: v${version}`);
} else {
  console.log(`Installer ref already v${version}`);
}
