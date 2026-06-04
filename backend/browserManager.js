import { chromium } from 'playwright';
import sharp from 'sharp';

const VIEWPORT = { width: 1280, height: 720 };

export class BrowserManager {
  constructor({ screencastQuality = 75, headless = true } = {}) {
    this.screencastQuality = screencastQuality;
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
    const point = {
      x: clamp(x, 0, VIEWPORT.width),
      y: clamp(y, 0, VIEWPORT.height)
    };
    await page.mouse.move(point.x, point.y);
    return this.cursorAtPoint(page, point);
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

  async cursorAtPoint(page, point) {
    const frames = page.frames().slice(1).reverse();
    for (const frame of frames) {
      const frameElement = await frame.frameElement().catch(() => null);
      const box = await frameElement?.boundingBox().catch(() => null);
      await frameElement?.dispose().catch(() => {});
      if (!box || !containsPoint(box, point)) continue;

      const cursor = await cursorInFrame(frame, {
        x: point.x - box.x,
        y: point.y - box.y
      });
      return normalizeCursor(cursor);
    }

    return normalizeCursor(await cursorInFrame(page.mainFrame(), point));
  }

  async startFrames(onFrame) {
    await this.stopFrames();
    if (!this.page || !this.context) return;

    const cdpSession = await this.context.newCDPSession(this.page);
    this.cdpSession = cdpSession;
    this.screencastFrameHandler = async ({ data, metadata, sessionId }) => {
      cdpSession.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      try {
        const webp = await sharp(Buffer.from(data, 'base64'))
          .webp({ quality: this.screencastQuality })
          .toBuffer();
        onFrame(webp, metadata);
      } catch {
        onFrame(Buffer.from(data, 'base64'), metadata);
      }
    };
    cdpSession.on('Page.screencastFrame', this.screencastFrameHandler);
    await cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: this.screencastQuality,
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

function containsPoint(box, point) {
  return point.x >= box.x && point.x <= box.x + box.width
    && point.y >= box.y && point.y <= box.y + box.height;
}

async function cursorInFrame(frame, point) {
  return frame.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    if (!element) return 'default';

    const computedCursor = getComputedStyle(element).cursor;
    if (computedCursor !== 'auto') return computedCursor;

    const editable = element.closest('input, textarea, [contenteditable]:not([contenteditable="false"])');
    if (editable && !editable.disabled) return 'text';
    if (element.closest('a[href], area[href]')) return 'pointer';
    return 'default';
  }, point).catch(() => 'default');
}

function normalizeCursor(cursor) {
  const allowed = new Set([
    'alias', 'all-scroll', 'auto', 'cell', 'col-resize', 'context-menu', 'copy',
    'crosshair', 'default', 'e-resize', 'ew-resize', 'grab', 'grabbing', 'help',
    'move', 'n-resize', 'ne-resize', 'nesw-resize', 'no-drop', 'none',
    'not-allowed', 'ns-resize', 'nw-resize', 'nwse-resize', 'pointer', 'progress',
    'row-resize', 's-resize', 'se-resize', 'sw-resize', 'text', 'vertical-text',
    'w-resize', 'wait', 'zoom-in', 'zoom-out'
  ]);
  return allowed.has(cursor) ? cursor : 'default';
}
