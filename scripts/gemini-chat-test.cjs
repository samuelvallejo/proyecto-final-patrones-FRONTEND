/* Deterministic browser coverage uses synthetic API responses and never consumes Gemini quota. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ui = JSON.parse(fs.readFileSync(path.join(__dirname, '../frontend/public/locales/es.json'), 'utf8'));
const base = process.env.TEST_WEB_URL || 'http://localhost:15173';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Chat browser tests require a local frontend');

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  const errors = []; const requests = [];
  let replyMode = 'success', configured = true, allowChannel = false, release;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const respond = (body, status = 200) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
    if (pathname === '/api/users/me') return respond({id: 'synthetic-user', username: 'Synthetic'});
    if (pathname === '/api/config') return respond({aiConfigured: true, aiMode: 'GEMINI', aiModel: 'gemini-2.5-flash'});
    if (pathname === '/api/assistant/chat/config') return respond({configured, provider: 'GEMINI', model: 'gemini-2.5-flash'});
    if (pathname === '/api/assistant/chat') {
      requests.push(route.request().postDataJSON());
      if (replyMode === 'pending') await new Promise(resolve => {release = resolve;});
      if (replyMode === 'quota') return respond({error: ui.geminiChatFailed}, 429);
      if (replyMode === 'invalid') return respond({provider: 'GEMINI', internalSecret: 'synthetic-private-fixture'});
      return respond({provider: 'GEMINI', model: 'gemini-2.5-flash', answer: '<img src=x onerror=alert(1)> A synthetic answer'});
    }
    if (pathname.includes('/channels')) {
      if (!allowChannel) throw new Error('Gemini chat must not require channel ownership');
      if (pathname === '/api/channels/mine') return respond([{id: 'synthetic-channel'}]);
      return respond({channel: {id: 'synthetic-channel', owner_id: 'synthetic-user'}, policy: {level: 'BALANCED'}});
    }
    return respond([]);
  });
  const navigate = async () => {await page.getByRole('button', {name: ui.geminiChatNavigation, exact: true}).click(); await page.getByLabel(ui.geminiChatQuestion, {exact: true}).waitFor();};
  const message = () => page.getByLabel(ui.geminiChatQuestion, {exact: true});
  const send = () => page.getByRole('button', {name: ui.geminiChatSend, exact: true});
  try {
    await page.goto(base); await navigate();
    await page.getByRole('button', {name: ui.geminiChatPromptOne, exact: true}).click();
    assert.equal(await message().inputValue(), ui.geminiChatPromptOne);
    assert.equal(await message().getAttribute('maxlength'), '2000');
    await send().click();
    await page.locator('.gemini-chat-assistant').waitFor();
    assert.equal(await page.locator('.gemini-chat-assistant img').count(), 0);
    assert((await page.locator('.gemini-chat-assistant').innerText()).includes('<img'));
    assert.equal(requests[0].history.length, 0);
    await message().fill('A follow-up'); replyMode = 'pending'; await send().click();
    await page.getByRole('status').filter({hasText: ui.geminiChatThinking}).waitFor();
    assert(await message().isDisabled()); assert(await send().isDisabled());
    await page.getByRole('button', {name: ui.uiShellText08, exact: true}).click();
    await navigate();
    assert(await message().isDisabled()); replyMode = 'success'; release();
    await page.waitForFunction(() => document.querySelectorAll('.gemini-chat-assistant').length === 2);
    assert.equal(requests[1].history.length, 2);
    assert.equal(requests[1].history[0].role, 'user');
    if (process.env.CHAT_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.CHAT_SCREENSHOT_DIR, {recursive: true});
      await page.screenshot({path: path.join(process.env.CHAT_SCREENSHOT_DIR, 'gemini-chat-desktop.png'), fullPage: true});
      await page.setViewportSize({width: 390, height: 844});
      await page.screenshot({path: path.join(process.env.CHAT_SCREENSHOT_DIR, 'gemini-chat-mobile.png'), fullPage: true});
      await page.setViewportSize({width: 1280, height: 900});
    }
    await message().fill('Retry me'); replyMode = 'quota'; await send().click();
    await page.getByRole('alert').filter({hasText: ui.geminiChatFailed}).waitFor();
    assert.equal(await message().inputValue(), 'Retry me'); assert(await send().isEnabled());
    replyMode = 'invalid'; await send().click();
    await page.getByRole('alert').filter({hasText: ui.geminiChatFailed}).waitFor();
    assert(!(await page.locator('body').innerText()).includes('synthetic-private-fixture'));
    await page.getByRole('button', {name: ui.geminiChatNew, exact: true}).click();
    assert.equal(await page.locator('.gemini-chat-turn').count(), 0);
    await page.setViewportSize({width: 390, height: 844});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    configured = false;
    await page.setViewportSize({width: 1280, height: 900}); await navigate();
    await page.getByText(ui.geminiChatUnavailable, {exact: true}).waitFor();
    assert(await message().isDisabled()); assert(await send().isDisabled());
    allowChannel = true;
    await page.getByRole('button', {name: ui.myStudio, exact: true}).click();
    await page.getByText(`${ui.aiProviderConfigured}: Gemini`, {exact: true}).waitFor();
    await page.getByText(`${ui.aiModelLabel}: gemini-2.5-flash`, {exact: true}).waitFor();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({passed: true, noChannelRequired: true, contextPreserved: true,
      safeTextRendering: true, retryPreservesQuestion: true, pendingSurvivesNavigation: true, mobileFits: true}));
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
