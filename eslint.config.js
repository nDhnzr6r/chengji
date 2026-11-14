'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['vendor/**', 'node_modules/**', '.shots/**', '.tmp/**']
  },
  js.configs.recommended,
  {
    files: ['assets/**/*.js'],
    languageOptions: {
      ecmaVersion: 5,
      sourceType: 'script',
      globals: Object.assign({}, globals.browser, globals.es2021)
    },
    rules: {
      /* 页面脚本要照顾老浏览器，catch 不能省略参数，空 catch 是故意的 */
      'no-unused-vars': ['error', { caughtErrors: 'none' }]
    }
  },
  {
    files: ['tests/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node
    }
  }
];
