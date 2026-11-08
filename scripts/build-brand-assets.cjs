'use strict';
// The traced master is the single geometry source; never redraw the small icon.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const logo = fs.readFileSync(path.join(root, 'media/logo.svg'), 'utf8');
const geometry = logo.match(/<path id="mark"[^>]*d="([^"]+)"/)[1];
const defs = logo.match(/<defs>([\s\S]+?)<\/defs>/)[1];
const title = 'Codex Switch';
const subtitle = 'Switch AI providers in Codex with a click.';
const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="320" viewBox="0 0 1200 320" role="img" aria-labelledby="title description">
  <title id="title">${title}</title>
  <desc id="description">The purple Codex Switch rosette and gear beside the words: ${subtitle}</desc>
  <defs>
    <linearGradient id="background" x2="1" y2="1"><stop stop-color="#F5F3FF"/><stop offset="1" stop-color="#EFF4FF"/></linearGradient>
    <linearGradient id="purpleDetail" gradientUnits="userSpaceOnUse" x1="950" y1="58" x2="1188" y2="256"><stop stop-color="#AB9EFC"/><stop offset=".48" stop-color="#738BFC"/><stop offset="1" stop-color="#3743FD"/></linearGradient>
    ${defs}
  </defs>
  <rect width="1200" height="320" rx="32" fill="url(#background)"/>
  <path transform="translate(74 70) scale(.18) translate(-128 -128)" fill="url(#purple)" fill-rule="evenodd" d="${geometry}"/>
  <g fill="none" stroke="url(#purpleDetail)" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1017 86 C1084 57 1152 82 1178 145 C1194 183 1188 223 1169 258" stroke-width="2.2" opacity=".38"/>
    <path d="M1185 242 L1169 261 L1149 247" stroke-width="2.2" opacity=".44"/>
    <path d="M1119 224 C1052 250 985 227 957 167 C941 133 944 96 960 63" stroke-width="2.2" opacity=".34"/>
    <path d="M944 80 L959 59 L981 73" stroke-width="2.2" opacity=".44"/>
  </g>
  <circle cx="1017" cy="86" r="5" fill="#9A8CFF" opacity=".48"/>
  <circle cx="1119" cy="224" r="5" fill="#5863FF" opacity=".5"/>
  <circle cx="1082" cy="155" r="2.5" fill="#738BFC" opacity=".4"/>
  <text x="282" y="155" fill="#35364D" font-family="Segoe UI,Arial,sans-serif" font-size="64" font-weight="650" letter-spacing="-2">${title}</text>
  <text x="285" y="205" fill="#69677F" font-family="Segoe UI,Arial,sans-serif" font-size="23">${subtitle}</text>
</svg>
`;
const sidebar = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <path fill="currentColor" fill-rule="evenodd" transform="translate(1 1) scale(${22 / 998}) translate(-128 -128)" d="${geometry}"/>
</svg>
`;
fs.writeFileSync(path.join(root, 'docs/banner.svg'), banner);
fs.writeFileSync(path.join(root, 'media/sidebar.svg'), sidebar);
console.log('Generated banner and 24px sidebar icon from media/logo.svg.');
