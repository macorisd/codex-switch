'use strict';
// The traced master is the single geometry source; never redraw the small icon.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const logo = fs.readFileSync(path.join(root, 'media/logo.svg'), 'utf8');
const geometry = logo.match(/<path id="mark"[^>]*d="([^"]+)"/)[1];
const defs = logo.match(/<defs>([\s\S]+?)<\/defs>/)[1];
const title = 'Codex Switch';
const subtitle = 'Switch AI providers in Codex with a click. Without ever leaving VS Code.';
const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="320" viewBox="0 0 1200 320" role="img" aria-labelledby="title description">
  <title id="title">${title}</title>
  <desc id="description">The purple Codex Switch rosette and gear beside the words: ${subtitle}</desc>
  <defs>
    ${defs}
  </defs>
  <rect x=".5" y=".5" width="1199" height="319" rx="28" fill="#FAFAF8" stroke="#E7E7E5"/>
  <path transform="translate(74 70) scale(.18) translate(-128 -128)" fill="url(#purple)" fill-rule="evenodd" d="${geometry}"/>
  <text x="282" y="155" fill="#25252E" font-family="Segoe UI,Arial,sans-serif" font-size="64" font-weight="650" letter-spacing="-2">${title}</text>
  <text x="285" y="205" fill="#65656F" font-family="Segoe UI,Arial,sans-serif" font-size="21">${subtitle}</text>
  <g fill="none" stroke-linecap="round" stroke-width="1.5" aria-hidden="true">
    <path d="M1030 194 H1045 C1080 194 1080 126 1115 126 H1140" stroke="#DFDEE7"/>
    <path d="M1030 126 H1045 C1080 126 1080 194 1115 194 H1140" stroke="#9689CA"/>
    <circle cx="1030" cy="126" r="3" fill="#9689CA" stroke="none"/>
    <circle cx="1140" cy="194" r="3" fill="#9689CA" stroke="none"/>
  </g>
</svg>
`;
const sidebar = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <path fill="currentColor" fill-rule="evenodd" transform="translate(1 1) scale(${22 / 998}) translate(-128 -128)" d="${geometry}"/>
</svg>
`;
fs.writeFileSync(path.join(root, 'docs/banner.svg'), banner);
fs.writeFileSync(path.join(root, 'media/sidebar.svg'), sidebar);
console.log('Generated banner and 24px sidebar icon from media/logo.svg.');
