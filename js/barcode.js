const BarcodeUtils = (() => {
  const CODE39 = {
    '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
    '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
    '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', 'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw',
    'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn', 'F': 'nnwnwwnnn',
    'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn', 'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn',
    'K': 'wnnnnnnww', 'L': 'nnwnnnnww', 'M': 'wnwnnnnwn', 'N': 'nnnnwnnww',
    'O': 'wnnnwnnwn', 'P': 'nnwnwnnwn', 'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn',
    'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn', 'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw',
    'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn', 'Z': 'nwwnwnnnn',
    '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn',
    '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
  };

  function normalize(value) {
    return String(value || '').toUpperCase().replace(/[^0-9A-Z.\- $/+%]/g, '');
  }

  function generate() {
    const stamp = `${Date.now()}`.slice(-10);
    const tail = `${Math.floor(Math.random() * 900) + 100}`;
    return normalize(`P${stamp}${tail}`);
  }

  function isValid(value) {
    const normalized = normalize(value);
    return normalized.length > 0 && normalized.split('').every((char) => !!CODE39[char]);
  }

  function toSVG(value, options = {}) {
    const normalized = normalize(value);
    if (!isValid(normalized)) return '';

    const quiet = options.quietZone ?? 12;
    const narrow = options.narrow ?? 2;
    const wide = options.wide ?? 5;
    const barHeight = options.height ?? 58;
    const fontSize = options.fontSize ?? 12;
    const showText = options.showText !== false;
    const encoded = `*${normalized}*`;

    let x = quiet;
    const parts = [];

    encoded.split('').forEach((char, charIndex) => {
      const pattern = CODE39[char];
      for (let i = 0; i < pattern.length; i++) {
        const width = pattern[i] === 'w' ? wide : narrow;
        const isBar = i % 2 === 0;
        if (isBar) {
          parts.push(`<rect x="${x}" y="0" width="${width}" height="${barHeight}" fill="#111"/>`);
        }
        x += width;
      }
      if (charIndex < encoded.length - 1) x += narrow;
    });

    const totalWidth = x + quiet;
    const totalHeight = barHeight + (showText ? fontSize + 12 : 0);
    const textY = barHeight + fontSize + 4;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">
      <rect width="${totalWidth}" height="${totalHeight}" fill="#fff"/>
      ${parts.join('')}
      ${showText ? `<text x="${totalWidth / 2}" y="${textY}" text-anchor="middle" font-family="monospace" font-size="${fontSize}" fill="#111">${normalized}</text>` : ''}
    </svg>`;
  }

  return { normalize, generate, isValid, toSVG };
})();
