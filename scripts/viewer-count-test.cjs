/* Local browser coverage with synthetic identities, camera tracks and WebSocket presence. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ui = JSON.parse(fs.readFileSync(path.join(__dirname, '../frontend/public/locales/es.json'), 'utf8'));
const base = process.env.TEST_WEB_URL || 'http://localhost:15173';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Viewer tests require a local frontend');

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']});
  const page = await browser.newPage({viewport: {width: 1280, height: 900}, permissions: ['camera', 'microphone']});
  const errors = [];
  let live = false, audience = 0, socket;
  const stream = () => ({id: 'synthetic-stream', channel_id: 'synthetic-channel', channel_name: 'Synthetic channel', title: 'Synthetic live', status: live ? 'LIVE' : 'ENDED', viewers: audience});
  const emit = viewers => {audience = viewers; socket.send(JSON.stringify({type: 'presence', viewers, hostOnline: true}));};
  page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket('**/ws', ws => {
    socket = ws;
    ws.onMessage(raw => {const message = JSON.parse(String(raw)); if (message.type === 'join') {ws.send(JSON.stringify({type: 'joined', hostOnline: true})); emit(audience);}});
  });
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url()), pathname = url.pathname;
    const respond = body => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(body)});
    if (pathname === '/api/users/me') return respond({id: 'synthetic-user', username: 'Synthetic'});
    if (pathname === '/api/config') return respond({aiConfigured: false, aiMode: 'LOCAL_RULES', iceServers: [], mediaRelayConfigured: false});
    if (pathname === '/api/auth/connection-ticket') return respond({ticket: 'synthetic-ticket'});
    if (pathname === '/api/channels/mine') return respond([{id: 'synthetic-channel'}]);
    if (pathname.endsWith('/dashboard')) return respond({channel: {id: 'synthetic-channel', owner_id: 'synthetic-user'}, policy: {level: 'BALANCED'}, stream: live ? stream() : null});
    if (pathname === '/api/categories') return respond([{id: 'synthetic-category', name: 'Synthetic category'}]);
    if (pathname === '/api/streams' && route.request().method() === 'POST') {live = true; return respond(stream());}
    if (pathname === '/api/streams/synthetic-stream') return respond(stream());
    if (pathname.endsWith('/collaboration')) return respond({active: false, participants: []});
    if (pathname.endsWith('/location')) return respond({shared: false});
    if (pathname === '/api/explore') return respond([stream()]);
    return respond([]);
  });
  const expectCount = async (count, selector = '.viewer-counter') => {
    const label = (count === 1 ? ui.viewerCounterOne : ui.viewerCounterMany).replace('{count}', String(count));
    await page.locator(selector).filter({hasText: label}).waitFor();
    assert.equal(await page.locator(selector + ' svg').count(), 1);
    assert.equal(await page.locator(selector).getAttribute('aria-label'), label);
  };
  const waitSocket = async () => {
    const deadline = Date.now() + 5000;
    while (!socket && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert(socket, 'Expected a live WebSocket connection');
  };
  try {
    await page.goto(base);
    await page.getByRole('button', {name: ui.myStudio, exact: true}).click();
    await page.getByLabel(ui.uiStudioText93, {exact: true}).fill('Synthetic live');
    await page.getByLabel(ui.captureSource, {exact: true}).selectOption('browser');
    await page.getByRole('button', {name: ui.uiStudioText96, exact: true}).click();
    await expectCount(0, '.live-heading-status .viewer-counter');
    await page.waitForFunction(() => document.querySelector('.live-heading-status'));
    await waitSocket();
    emit(7); await expectCount(7, '.live-heading-status .viewer-counter');
    emit(1); await expectCount(1, '.live-heading-status .viewer-counter');
    await page.getByRole('button', {name: ui.uiShellText08, exact: true}).click();
    await expectCount(1, '.floating-player .viewer-counter');
    emit(2); await expectCount(2, '.floating-player .viewer-counter');
    await page.getByRole('button', {name: ui.returnToStudio, exact: true}).click();
    await expectCount(2, '.live-heading-status .viewer-counter');
    if (process.env.VIEWER_SCREENSHOT_DIR) {fs.mkdirSync(process.env.VIEWER_SCREENSHOT_DIR, {recursive: true}); await page.screenshot({path: path.join(process.env.VIEWER_SCREENSHOT_DIR, 'studio-viewers.png'), fullPage: true});}
    await page.setViewportSize({width: 390, height: 844});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.VIEWER_SCREENSHOT_DIR) await page.screenshot({path: path.join(process.env.VIEWER_SCREENSHOT_DIR, 'studio-viewers-mobile.png'), fullPage: true});
    // A fresh viewer session exercises the watch page without creating production data.
    await page.setViewportSize({width: 1280, height: 900});
    audience = 3; socket = null; await page.reload();
    await page.getByRole('button', {name: ui.uiExploreText32, exact: true}).click();
    await expectCount(3, '.watch-grid .viewer-counter');
    await waitSocket();
    emit(0); await expectCount(0, '.watch-grid .viewer-counter');
    socket.send(JSON.stringify({type: 'ended'}));
    await page.getByText(ui.liveEndedTitle, {exact: true}).waitFor();
    await expectCount(0, '.watch-grid .viewer-counter');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({passed: true, studioRealtime: true, floatingRealtime: true, singularLabel: true, watchRealtime: true, mobileFits: true}));
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
