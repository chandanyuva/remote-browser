import { chromium } from 'playwright';

const VIEWPORT = { width: 1280, height: 720 };

export class BrowserManager {
  constructor({ jpegQuality = 55, headless = true } = {}) {
    this.jpegQuality = jpegQuality;
    this.headless = headless;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.ownerId = null;
    this.cdpSession = null;
    this.screencastFrameHandler = null;
  }

  get state() {
    return {
      active: Boolean(this.page),
      ownerId: this.ownerId,
      viewport: VIEWPORT,
      url: this.page?.url() ?? null
    };
  }

  async create(ownerId, url, onFrame, onStatus) {
    if (this.page) {
      throw new Error('A browser session is already active.');
    }

    const target = normalizeUrl(url);
    this.ownerId = ownerId;

    try {
      this.browser = await chromium.launch({
        headless: this.headless,
        args: ['--ignore-certificate-errors']
      });
      this.context = await this.browser.newContext({
        viewport: VIEWPORT,
        ignoreHTTPSErrors: true
      });
      this.page = await this.context.newPage();
      this.page.on('framenavigated', (frame) => {
        if (frame === this.page?.mainFrame()) {
          onStatus({ url: frame.url(), title: null });
        }
      });
      this.page.on('close', () => this.stopFrames());

      await this.page.goto(target, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000
      });
      await this.emitPageStatus(onStatus);
      await this.startFrames(onFrame);
      return this.state;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async navigate(ownerId, url, onStatus) {
    const page = this.getOwnedPage(ownerId);
    await page.goto(normalizeUrl(url), {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    });
    await this.emitPageStatus(onStatus);
  }

  async click(ownerId, x, y) {
    const page = this.getOwnedPage(ownerId);
    await page.mouse.click(clamp(x, 0, VIEWPORT.width), clamp(y, 0, VIEWPORT.height));
  }

  async move(ownerId, x, y) {
    const page = this.getOwnedPage(ownerId);
    await page.mouse.move(clamp(x, 0, VIEWPORT.width), clamp(y, 0, VIEWPORT.height));
  }

  async keyDown(ownerId, key) {
    await this.getOwnedPage(ownerId).keyboard.down(normalizeKey(key));
  }

  async keyUp(ownerId, key) {
    await this.getOwnedPage(ownerId).keyboard.up(normalizeKey(key));
  }

  async close(ownerId) {
    if (ownerId && this.ownerId !== ownerId) return;

    await this.stopFrames();
    this.page = null;
    this.ownerId = null;

    const context = this.context;
    const browser = this.browser;
    this.context = null;
    this.browser = null;

    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }

  getOwnedPage(ownerId) {
    if (!this.page) throw new Error('No active browser session.');
    if (this.ownerId !== ownerId) throw new Error('This session belongs to another client.');
    return this.page;
  }

  async startFrames(onFrame) {
    await this.stopFrames();
    if (!this.page || !this.context) return;

    const cdpSession = await this.context.newCDPSession(this.page);
    this.cdpSession = cdpSession;
    this.screencastFrameHandler = ({ data, metadata, sessionId }) => {
      cdpSession.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      onFrame(Buffer.from(data, 'base64'), metadata);
    };
    cdpSession.on('Page.screencastFrame', this.screencastFrameHandler);
    await cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: this.jpegQuality,
      maxWidth: VIEWPORT.width,
      maxHeight: VIEWPORT.height,
      everyNthFrame: 1
    });
  }

  async stopFrames() {
    const cdpSession = this.cdpSession;
    const frameHandler = this.screencastFrameHandler;
    this.cdpSession = null;
    this.screencastFrameHandler = null;

    if (!cdpSession) return;
    if (frameHandler) cdpSession.off('Page.screencastFrame', frameHandler);
    await cdpSession.send('Page.stopScreencast').catch(() => {});
    await cdpSession.detach().catch(() => {});
  }

  async emitPageStatus(onStatus) {
    if (!this.page) return;
    const title = await this.page.title().catch(() => '');
    onStatus({ url: this.page.url(), title });
  }
}

export function normalizeUrl(input) {
  const value = String(input ?? '').trim();
  if (!value) throw new Error('Enter a router URL.');

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`;
  const url = new URL(withProtocol);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }
  return url.toString();
}

function normalizeKey(key) {
  const allowedModifiers = new Set(['Alt', 'Control', 'Meta', 'Shift']);
  const value = String(key ?? '');
  if (allowedModifiers.has(value) || value.length === 1) return value;

  const aliases = {
    ' ': 'Space',
    ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',
    ArrowUp: 'ArrowUp',
    Backspace: 'Backspace',
    Delete: 'Delete',
    End: 'End',
    Enter: 'Enter',
    Escape: 'Escape',
    Home: 'Home',
    PageDown: 'PageDown',
    PageUp: 'PageUp',
    Tab: 'Tab'
  };
  return aliases[value] ?? '';
}

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}
