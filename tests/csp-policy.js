// The Content-Security-Policy in _headers: it limits where the page may connect to, its inline script is the one the policy names, and the browser refuses to send data to another site.
const { chromium } = require('playwright-core'), fs = require('fs'), crypto = require('crypto');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const headers = fs.readFileSync('_headers', 'utf8'), policy = (headers.match(/Content-Security-Policy:\s*(.*)/) || [])[1] || '';
  ok(/(^|;\s*)connect-src 'self'[^;]*(;|$)/.test(policy), "_headers has connect-src 'self'");
  ok(!/connect-src[^;]*(https?:|\*)/.test(policy), 'connect-src names no other site');
  const html = fs.readFileSync('index.html', 'utf8'), inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => 'sha256-' + crypto.createHash('sha256').update(m[1]).digest('base64'));
  ok(inline.length > 0 && inline.every(h => policy.includes("'" + h + "'")), 'the inline script in index.html is named by its hash in the policy (' + inline.length + ' inline)');
  const b = await chromium.launch(), p = await b.newPage(), seen = [];
  p.on('console', m => seen.push(m.text()));
  const port = process.env.PORT || 8123;
  await p.goto('http://localhost:' + port + '/index.html'); await p.waitForTimeout(500);
  const sent = await p.evaluate(async () => { try { await fetch('https://upload-test.invalid/', { method: 'POST', body: 'x', mode: 'no-cors' }); return 'sent'; } catch (e) { return 'blocked'; } });
  ok(sent === 'blocked', 'a POST to another site is blocked by the browser');
  ok(seen.some(t => /Content Security Policy/i.test(t) && /connect-src/.test(t)), 'the browser reports the blocked request as a connect-src violation');
  const fe = await p.evaluate(async () => { try { const r = await fetch('VERSION.txt'); return r.ok; } catch (e) { return false; } });
  ok(fe, "the page can still read its own server's VERSION.txt");
  await b.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
