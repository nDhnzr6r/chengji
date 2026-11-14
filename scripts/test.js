'use strict';

/* 跑 tests 目录下的全部测试文件。各版本 Node 对目录参数的处理不一致，这里自己把文件列出来 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const dir = path.join(__dirname, '..', 'tests');
const files = fs
  .readdirSync(dir)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join(dir, name));

const child = spawn(process.execPath, ['--test', ...files], { stdio: 'inherit' });

child.on('exit', (code) => {
  process.exit(code === null ? 1 : code);
});
