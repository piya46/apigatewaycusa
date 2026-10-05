'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const files = ['app.js', 'package.json', 'package-lock.json', '.env.example', '.gitignore', 'README.md'];

function collect(relative) {
  const absolute = path.join(root, relative);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error('Symlinks are not allowed in the deployment package');
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(absolute).sort()) collect(path.join(relative, name));
  } else if (/\.(js|css|html|md|example)$/.test(relative)) files.push(relative);
}

function main() {
  for (const directory of ['src', 'public', 'scripts', 'test', 'deploy']) collect(directory);
  for (const file of files) {
    if (!fs.lstatSync(path.join(root, file)).isFile()) throw new Error('Package inputs must be regular files');
  }
  const outputDir = path.join(root, 'dist');
  fs.mkdirSync(outputDir, { recursive: true });
  const output = path.join(outputDir, 'reunion-gateway-plesk.zip');
  // A fresh archive cannot retain a removed file from an older package.
  const temporary = path.join(outputDir, `reunion-gateway-${process.pid}.zip`);
  const result = spawnSync('zip', ['-q', temporary, '-@'], { cwd: root, input: files.join('\n') + '\n', encoding: 'utf8' });
  if (result.status !== 0) throw new Error('zip command failed');
  fs.renameSync(temporary, output);
  const checksum = createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  fs.writeFileSync(output + '.sha256', `${checksum}  reunion-gateway-plesk.zip\n`);
  process.stdout.write(`Created dist/reunion-gateway-plesk.zip (${files.length} files).\nSecrets, .env, logs and node_modules are excluded.\n`);
}

try { main(); } catch {
  process.stderr.write('Could not create deployment package. Check that zip is installed and project files are readable.\n');
  process.exitCode = 1;
}
