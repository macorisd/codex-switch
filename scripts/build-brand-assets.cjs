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
const wrapAt = subtitle.indexOf(' Without ') + 1;
const subtitleLines = [subtitle.slice(0, wrapAt), subtitle.slice(wrapAt)];
const pixelArt = fs.readFileSync(path.join(root, 'docs/banner-pixelart.png')).toString('base64');
const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="320" viewBox="0 0 1200 320" role="img" aria-labelledby="title description">
  <title id="title">${title}</title>
  <desc id="description">The purple Codex Switch rosette and gear beside the words: ${subtitle} Pixel art fades into the light background on the right.</desc>
  <defs>
    ${defs}
    <linearGradient id="pixel-art-fade" gradientUnits="userSpaceOnUse" x1="718.28" y1="0" x2="815" y2="0">
      <stop stop-color="#FFF" stop-opacity="0"/>
      <stop offset=".2" stop-color="#FFF" stop-opacity=".1"/>
      <stop offset=".45" stop-color="#FFF" stop-opacity=".4"/>
      <stop offset=".7" stop-color="#FFF" stop-opacity=".75"/>
      <stop offset=".9" stop-color="#FFF" stop-opacity=".96"/>
      <stop offset="1" stop-color="#FFF"/>
    </linearGradient>
    <mask id="pixel-art-blend" maskUnits="userSpaceOnUse" x="700" y="0" width="500" height="320">
      <rect x="700" width="500" height="320" fill="url(#pixel-art-fade)"/>
    </mask>
    <clipPath id="banner-bounds"><rect width="1200" height="320" rx="24"/></clipPath>
  </defs>
  <g clip-path="url(#banner-bounds)" style="image-rendering:pixelated">
    <rect width="1200" height="320" fill="#FAFAF8"/>
    <image x="700" width="500" height="320" preserveAspectRatio="xMaxYMid meet" href="data:image/png;base64,${pixelArt}" mask="url(#pixel-art-blend)" image-rendering="optimizeSpeed" aria-hidden="true"/>
    <path transform="translate(74 70) scale(.18) translate(-128 -128)" fill="url(#purple)" fill-rule="evenodd" d="${geometry}"/>
    <text x="282" y="141" fill="#35364D" font-family="Segoe UI,Arial,sans-serif" font-size="64" font-weight="650" letter-spacing="-2">${title}</text>
    <text x="285" y="188" fill="#69677F" font-family="Segoe UI,Arial,sans-serif" font-size="23" xml:space="preserve">${subtitleLines.map((line, index) => `<tspan x="285" dy="${index ? 31 : 0}">${line}</tspan>`).join('')}</text>
  </g>
  <rect x=".5" y=".5" width="1199" height="319" rx="24" fill="none" stroke="#E9E7EC"/>
</svg>
`;
const sidebar = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <path fill="currentColor" fill-rule="evenodd" transform="translate(1 1) scale(${22 / 998}) translate(-128 -128)" d="${geometry}"/>
</svg>
`;
fs.writeFileSync(path.join(root, 'docs/banner.svg'), banner);
fs.writeFileSync(path.join(root, 'media/sidebar.svg'), sidebar);
console.log('Generated banner and 24px sidebar icon from media/logo.svg.');
