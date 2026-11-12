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
const wrapAt = subtitle.indexOf(' ever ') + 1;
const subtitleLines = [subtitle.slice(0, wrapAt), subtitle.slice(wrapAt)];
// Two continuous, evenly spaced ribbons. The foreground passes over the other
// with a narrow paper-colored clearance, rather than an ambiguous intersection.
const ribbon = (lane, reverse = false) => {
  const start = (reverse ? 1166 : 946) + lane * 8;
  const end = (reverse ? 946 : 1166) + lane * 8;
  return `M${start} -35 C${start} 100 ${end} 220 ${end} 355`;
};
const contours = (reverse, stroke, width) => Array.from({ length: 7 }, (_, lane) =>
  `<path d="${ribbon(lane, reverse)}" stroke="${stroke}" stroke-width="${width}"/>`).join('\n      ');
const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="320" viewBox="0 0 1200 320" role="img" aria-labelledby="title description">
  <title id="title">${title}</title>
  <desc id="description">The purple Codex Switch rosette and gear beside the words: ${subtitle}</desc>
  <defs>
    ${defs}
    <linearGradient id="flow-ink" gradientUnits="userSpaceOnUse" x1="970" y1="0" x2="1170" y2="320"><stop stop-color="#B6A8D6"/><stop offset=".5" stop-color="#8874B9"/><stop offset="1" stop-color="#655099"/></linearGradient>
    <clipPath id="banner-bounds"><rect width="1200" height="320" rx="24"/></clipPath>
  </defs>
  <g clip-path="url(#banner-bounds)">
    <rect width="1200" height="320" fill="#FAFAF8"/>
    <path transform="translate(74 70) scale(.18) translate(-128 -128)" fill="url(#purple)" fill-rule="evenodd" d="${geometry}"/>
    <text x="282" y="141" fill="#35364D" font-family="Segoe UI,Arial,sans-serif" font-size="64" font-weight="650" letter-spacing="-2">${title}</text>
    <text x="285" y="188" fill="#69677F" font-family="Segoe UI,Arial,sans-serif" font-size="23" xml:space="preserve">${subtitleLines.map((line, index) => `<tspan x="285" dy="${index ? 31 : 0}">${line}</tspan>`).join('')}</text>
    <g fill="none" aria-hidden="true">
      ${contours(true, '#D5D1DE', 1.3)}
      <path d="${ribbon(3)}" stroke="#FAFAF8" stroke-width="63"/>
      <path d="${ribbon(3)}" stroke="#EFEBF6" stroke-width="48"/>
      ${contours(false, 'url(#flow-ink)', 1.5)}
    </g>
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
