'use strict';
// The traced master is the single geometry source; never redraw the small icon.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const logo = fs.readFileSync(path.join(root, 'media/logo.svg'), 'utf8');
const geometry = logo.match(/<path id="mark"[^>]*d="([^"]+)"/)[1];
const defs = logo.match(/<defs>([\s\S]+?)<\/defs>/)[1];
const title = 'codex-switch';
const subtitle = 'Your project. Your choice of model.';
const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="320" viewBox="0 0 1200 320" role="img" aria-labelledby="title description">
  <title id="title">${title}</title>
  <desc id="description">The purple codex-switch rosette and gear beside the words: ${subtitle}</desc>
  <defs>
    <linearGradient id="background" x2="1" y2="1"><stop stop-color="#F5F3FF"/><stop offset="1" stop-color="#EFF4FF"/></linearGradient>
    ${defs}
  </defs>
  <rect width="1200" height="320" rx="32" fill="url(#background)"/>
  <path transform="translate(74 70) scale(.18) translate(-128 -128)" fill="url(#purple)" fill-rule="evenodd" d="${geometry}"/>
  <text x="282" y="145" fill="#35364D" font-family="Segoe UI,Arial,sans-serif" font-size="64" font-weight="650" letter-spacing="-2">${title}</text>
  <text x="285" y="195" fill="#69677F" font-family="Segoe UI,Arial,sans-serif" font-size="23">${subtitle}</text>
</svg>
`;
const sidebar = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <path fill="currentColor" fill-rule="evenodd" transform="translate(1 1) scale(${22 / 998}) translate(-128 -128)" d="${geometry}"/>
</svg>
`;
fs.writeFileSync(path.join(root, 'docs/banner.svg'), banner);
fs.writeFileSync(path.join(root, 'media/sidebar.svg'), sidebar);
console.log('Generated banner and 24px sidebar icon from media/logo.svg.');
