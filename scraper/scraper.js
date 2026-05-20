// scraping nolatinbooks aeneid

const fs = require('fs');

const URL = 'https://nolatinbooks.blogspot.com/p/aeneid-i-1-11.html';
const DEFAULT_OUTPUT = 'aeneid_i_1-11.json';

function getAttr(attrString, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = attrString.match(re);
  if (!m) return '';
  return m[1] !== undefined ? m[1] : m[2];
}

function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&'); // last so we don't double-decode
}

function scrapeFromHTML(html) {
  const spanRegex = /<span\b([^>]*\bdata-latin\b[^>]*)>([\s\S]*?)<\/span>/gi;
  const results = [];
  let lineIndex = 0;
  let lastEndInLine = -1;

  let match;
  while ((match = spanRegex.exec(html)) !== null) {
    const attrs = match[1];
    const innerText = match[2].replace(/<[^>]+>/g, '');
    results.push({
      word: decodeEntities(innerText).trim(),
      latin: decodeEntities(getAttr(attrs, 'data-latin')),
      dictionary: decodeEntities(getAttr(attrs, 'data-dictionary')),
      english: decodeEntities(getAttr(attrs, 'data-english')),
      note: decodeEntities(getAttr(attrs, 'data-note')),
      _startOffset: match.index,
    });
  }

  const passageMatch = html.match(/<div\s+id=["']mainpassage["'][\s\S]*?>([\s\S]*?)<\/div>\s*(?:<br>|<div\s+id=["']infopage)/i);
  if (passageMatch) {
    const passageStart = html.indexOf(passageMatch[1]);
    const passage = passageMatch[1];
    const lineStarts = []; // absolute offsets of each <div> in the passage
    const divRe = /<div\b[^>]*>/gi;
    let dm;
    while ((dm = divRe.exec(passage)) !== null) {
      lineStarts.push(passageStart + dm.index);
    }
    for (const w of results) {
      let line = 0;
      for (let i = 0; i < lineStarts.length; i++) {
        if (w._startOffset >= lineStarts[i]) line = i + 1;
        else break;
      }
      w.line = line || null;
    }
  }

  for (const w of results) delete w._startOffset;
  return results;
}

async function loadHTML(source) {
  if (!source || /^https?:\/\//i.test(source || URL)) {
    const target = source || URL;
    console.error(`Fetching ${target} ...`);
    const res = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AeneidScraper/1.0)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${target}`);
    return await res.text();
  }
  return fs.readFileSync(source, 'utf8');
}

async function main() {
  const args = process.argv.slice(2);
  let input = null;
  let output = DEFAULT_OUTPUT;

  if (args.length === 1) {
    if (args[0].endsWith('.json')) output = args[0];
    else input = args[0];
  } else if (args.length >= 2) {
    input = args[0];
    output = args[1];
  }

  const html = await loadHTML(input);
  const data = scrapeFromHTML(html);

  if (data.length === 0) {
    console.error('WARNING: 0 annotated spans found. The page may have changed structure, or the response was not the expected HTML.');
  }

  fs.writeFileSync(output, JSON.stringify(data, null, 2), 'utf8');
  console.error(`Wrote ${data.length} entries to ${output}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});