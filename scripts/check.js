'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function check(file) {
  if (fs.statSync(file).isDirectory()) {
    for (const name of fs.readdirSync(file)) check(path.join(file, name));
  } else if (file.endsWith('.js')) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0) process.exitCode = 1;
  }
}
for (const item of ['app.js', 'src', 'scripts', 'public', 'test']) check(path.join(root, item));
