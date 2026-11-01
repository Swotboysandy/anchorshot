export const SAMPLE_WIDTH = 1120;
export const SAMPLE_HEIGHT = 700;
const body =
  'M465 332 Q465 322 477 322 H640 Q652 322 652 334 L642 492 Q638 532 559 532 Q480 532 476 492 Z';
const handle = 'M645 350 C758 333 770 474 641 474 L644 445 C709 444 722 377 646 381 Z';
const cup = (fill: string) =>
  `<path d="${handle}" fill="${fill}"/><path d="${body}" fill="${fill}"/><ellipse cx="559" cy="332" rx="94" ry="20" fill="${fill}"/>`;

export const SAMPLE_MASK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="700"><rect width="1120" height="700" fill="black"/>${cup('white')}</svg>`;

export const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="700" viewBox="0 0 1120 700">
<defs>
  <linearGradient id="wall" x2="0.8" y2="1"><stop stop-color="#9eaa9e"/><stop offset="1" stop-color="#52665a"/></linearGradient>
  <linearGradient id="window" x2="0" y2="1"><stop stop-color="#c1d2cb"/><stop offset="1" stop-color="#7b9990"/></linearGradient>
  <linearGradient id="wood" x2="1" y2="0.7"><stop stop-color="#d8bb92"/><stop offset="1" stop-color="#a78667"/></linearGradient>
  <linearGradient id="glaze"><stop stop-color="#953e30"/><stop offset="0.21" stop-color="#c66049"/><stop offset="0.46" stop-color="#d47a5d"/><stop offset="0.76" stop-color="#b94e3b"/><stop offset="1" stop-color="#863727"/></linearGradient>
  <linearGradient id="rim" x2="0" y2="1"><stop stop-color="#df8b6c"/><stop offset="1" stop-color="#a84330"/></linearGradient>
  <filter id="blur"><feGaussianBlur stdDeviation="9"/></filter>
  <filter id="soft"><feGaussianBlur stdDeviation="2"/></filter>
</defs>
<rect width="1120" height="700" fill="url(#wall)"/>
<rect x="-20" y="-20" width="755" height="426" rx="8" fill="#40544a"/>
<rect x="12" y="0" width="697" height="387" fill="url(#window)"/>
<g fill="#506b61" opacity="0.48" filter="url(#blur)"><path d="M0 260 L80 155 L160 265 L230 200 L325 277 L423 150 L480 241 L580 148 L700 276 V390 H0Z"/></g>
<g stroke="#e6ede6" stroke-width="2" opacity="0.38">
 <path d="M52 28l-8 64m76 24l-7 84m84-150l-12 136m67 43l-8 94m82-300l-13 120m88 38l-8 112m91-208l-10 66m70 61l-14 139m64-322l-5 86m42 94l-10 112"/>
</g>
<path d="M340 0V387M0 240H710" stroke="#3e554a" stroke-width="14"/>
<rect x="0" y="386" width="745" height="27" rx="3" fill="#374c40"/>
<path d="M0 442L1120 409V700H0Z" fill="url(#wood)"/>
<g stroke="#765e49" opacity="0.14" fill="none"><path d="M0 561L1120 504M0 665L1120 594" stroke-width="2"/><path d="M42 470l930-37M126 618l665-38M655 661l390-28"/></g>
<ellipse cx="601" cy="545" rx="177" ry="30" fill="#4c3c2c" opacity="0.27" filter="url(#blur)"/>
<g transform="rotate(-9 260 536)"><rect x="118" y="483" width="226" height="130" rx="5" fill="#d0cfb8"/><rect x="117" y="477" width="226" height="126" rx="5" fill="#354f46"/><path d="M144 480v121" stroke="#71927a" stroke-width="2"/><path d="M183 517h116m-116 13h78" stroke="#a6b2a1" opacity="0.7"/><rect x="290" y="478" width="8" height="126" fill="#223b33" opacity="0.7"/></g>
<g fill="#304c3c"><path d="M967 444C964 329 945 254 917 195" stroke="#354e3b" stroke-width="7" fill="none"/><path d="M945 333Q861 320 877 257Q939 265 945 333M931 276Q975 198 1009 232Q1007 283 931 276M917 222Q854 199 868 147Q926 168 917 222M956 379Q1011 302 1040 344Q1015 391 956 379"/></g>
<path d="M903 403H1014L998 492Q957 505 918 489Z" fill="#b8ad90"/><ellipse cx="959" cy="403" rx="56" ry="13" fill="#7c7c61"/>
${cup('url(#glaze)')}
<ellipse cx="559" cy="332" rx="94" ry="20" fill="url(#rim)"/><ellipse cx="559" cy="333" rx="80" ry="13" fill="#503528"/><path d="M485 333Q555 317 630 333" stroke="#e6ac8d" stroke-width="3" fill="none" opacity="0.8"/>
<path d="M491 368l7 113Q501 495 514 499" stroke="#e9a888" stroke-width="8" stroke-linecap="round" fill="none" opacity="0.35" filter="url(#soft)"/>
<path d="M535 292C508 263 564 248 546 212M576 288C610 257 562 237 580 205" stroke="#e1e4d9" stroke-width="5" fill="none" opacity="0.23" filter="url(#soft)"/>
</svg>`;
