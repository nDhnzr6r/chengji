'use strict';

/* 版本号只写在 package.json，页面引用和更新记录由这里同步 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const PKG = path.join(root, 'package.json');
const HTML = path.join(root, 'index.html');
const LOG = path.join(root, 'CHANGELOG.md');

const LOG_TITLE = '# 更新记录';
const SEMVER = /^\d+\.\d+\.\d+$/;
const V_ATTR = /\?v=[^"'&\s]*/g;
const LOG_HEAD = /^## \[([^\]]+)\]/gm;

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function write(file, text) {
  fs.writeFileSync(file, text);
}

function readVersion() {
  return JSON.parse(read(PKG)).version;
}

function htmlVersions(html) {
  return Array.from(html.matchAll(V_ATTR), (m) => m[0].slice(3));
}

function logVersions(md) {
  return Array.from(md.matchAll(LOG_HEAD), (m) => m[1]);
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function set(version) {
  if (!SEMVER.test(version)) throw new Error('版本号要写成三段数字，例如 1.3.0');

  const pkg = JSON.parse(read(PKG));
  pkg.version = version;
  write(PKG, JSON.stringify(pkg, null, 2) + '\n');

  write(HTML, read(HTML).replace(V_ATTR, '?v=' + version));

  const md = read(LOG);
  if (!logVersions(md).includes(version)) {
    const entry = '## [' + version + '] - ' + today() + '\n\n### 改进\n\n';
    const at = md.indexOf(LOG_TITLE) + LOG_TITLE.length;
    write(LOG, md.slice(0, at) + '\n\n' + entry + md.slice(at).replace(/^\s*\n/, ''));
  }

  console.log('版本号改成 ' + version);
}

function check() {
  const version = readVersion();
  const problems = [];

  if (!SEMVER.test(version)) problems.push('package.json 里的版本号不是三段数字：' + version);

  const found = htmlVersions(read(HTML));
  if (!found.length) problems.push('index.html 里没有带 ?v= 的资源引用');
  found.forEach((v) => {
    if (v !== version) problems.push('index.html 里还写着 ?v=' + v);
  });

  const head = logVersions(read(LOG))[0];
  if (head !== version) problems.push('CHANGELOG.md 最上面一条是 ' + (head || '空的') + '，应当是 ' + version);

  if (problems.length) {
    console.error('版本号对不上：');
    problems.forEach((p) => console.error('  ' + p));
    console.error('跑 npm run version:set -- ' + version + ' 一次改齐。');
    process.exit(1);
  }

  console.log('版本号一致：' + version);
}

const args = process.argv.slice(2);

try {
  if (args[0] === '--check') {
    check();
  } else if (args[0] === '--set') {
    if (!args[1]) throw new Error('要带上版本号，例如 npm run version:set -- 1.3.0');
    set(args[1]);
  } else {
    console.log('用法：node scripts/version.js [--check | --set 1.3.0]');
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
