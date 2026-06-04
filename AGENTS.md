# agents.md

## Project: Remote Router Browser Control Prototype

### Goal

Build a prototype system that:

* Opens a router admin page inside a browser running on the backend machine
* Allows the frontend to remotely view and control that browser
* Keeps router access isolated to the backend machine only
* Works with problematic router UIs (frame-based pages, old JS, self-signed HTTPS, etc.)

The frontend should never directly connect to the router.

---

# High-Level Architecture

```text
React Frontend
    ↕ WebSocket
Node.js Backend
    ↕
Playwright Chromium Session
    ↕
Router Admin Page
```

---

# Core Concept

Instead of embedding router pages using iframes or reverse proxies:

* Launch Chromium on the backend
* Open the router admin page in Chromium
* Stream JPEG frames using the Chrome DevTools Protocol screencast API
* Send frontend mouse/keyboard events back to backend
* Inject those events into the Playwright browser session

This creates a lightweight remote browser system specialized for router admin interfaces.

---

# Why This Approach

Router admin pages often fail with:

* iframe restrictions
* CSP/X-Frame-Options
* self-signed certificates
* frame-based layouts
* old JavaScript
* broken redirects
* same-origin restrictions

A backend-controlled browser bypasses these problems entirely.

---

# MVP Scope

## Required Features

* Launch browser session
* Navigate to router URL
* Live CDP screencast streaming
* Mouse click support
* Keyboard input support
* Single-user support
* Single active session initially

---

# Non-Goals (Later Phases)

Do NOT implement initially:

* Authentication
* Multi-user sessions
* Browser pooling
* Audio streaming
* File uploads
* WebRTC
* Video encoding
* Multi-tab support
* Persistent sessions
* Session recording

---

# Recommended Stack

## Backend

* Node.js
* Express
* Socket.IO
* Playwright

## Frontend

* React
* Socket.IO Client

---

# Suggested Project Structure

```text
project/
├── backend/
│   ├── server.js
│   ├── browserManager.js
│   ├── websocket/
│   └── sessions/
│
├── frontend/
│   ├── src/
│   │   ├── BrowserView.jsx
│   │   ├── socket.js
│   │   └── App.jsx
```

---

# Backend Responsibilities

## browserManager.js

Responsible for:

* launching Chromium
* creating Playwright pages
* maintaining active sessions
* CDP screencast frame generation
* event injection
* cleanup

---

# Browser Configuration

Use Playwright Chromium.

Initially run in headed mode for debugging:

```js
headless: false
```

Later switch to:

```js
headless: true
```

Recommended viewport:

```js
viewport: {
  width: 1280,
  height: 720
}
```

Important launch flags:

```js
ignoreHTTPSErrors: true
args: ['--ignore-certificate-errors']
```

Router UIs commonly use invalid/self-signed certificates.

---

# Navigation Strategy

Use:

```js
waitUntil: 'domcontentloaded'
```

Avoid:

```js
waitUntil: 'networkidle'
```

Many router pages never fully finish loading.

---

# CDP Screencast Streaming

## Initial Approach

Use:

* `Page.startScreencast`
* JPEG screencast frames
* WebSocket transport

Avoid:

* screenshot polling loops
* WebRTC
* H264 encoding
* GPU streaming
* advanced codecs

Router admin pages are low-motion UIs, so JPEG screencast frames are sufficient.

---

# Screencast Configuration

Target:

* acknowledge every received frame with `Page.screencastFrameAck`
* forward binary JPEG frame data to the frontend
* use the configured browser viewport as the maximum frame dimensions

Recommended settings:

```js
await cdpSession.send('Page.startScreencast', {
  format: 'jpeg',
  quality: 55,
  maxWidth: 1280,
  maxHeight: 720,
  everyNthFrame: 1
});
```

---

# Frontend Rendering

Decode incoming JPEG frames and draw them into a fixed-resolution canvas:

```js
const bitmap = await createImageBitmap(frameBlob);
context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
bitmap.close();
```

Where:

* canvas dimensions match the backend browser viewport
* CSS scales the canvas for display
* mouse coordinates are translated back to viewport coordinates
* the backend reports the computed cursor style under the pointer so the canvas can mirror it

---

# Input Event Flow

## Mouse

Frontend captures:

* click coordinates

Send:

```js
{
  type: 'click',
  x,
  y
}
```

Backend executes:

```js
await page.mouse.click(x, y);
```

---

# Keyboard

Frontend:

* listens for keydown events

Backend:

```js
await page.keyboard.press(key);
```

---

# Coordinate Scaling

Critical requirement.

Frontend image dimensions will differ from actual browser viewport dimensions.

Need coordinate translation:

```js
realX = clickX * viewportWidth / renderedWidth
realY = clickY * viewportHeight / renderedHeight
```

Without this, clicks will be inaccurate.

---

# WebSocket Event Suggestions

## Backend → Frontend

```text
frame
session-created
session-closed
error
```

## Frontend → Backend

```text
mouse-click
mouse-move
keydown
keyup
navigate
```

---

# Suggested MVP Development Order

## Phase 1

* Launch Chromium
* Open router page
* Manual local testing

## Phase 2

* CDP screencast streaming
* Frontend canvas rendering

## Phase 3

* Mouse input support
* Keyboard support

## Phase 4

* Session management
* Multiple routers
* Router inventory integration

---

# Recommended Initial Router Tests

Test against difficult routers first:

* TP-Link frame-based UI
* old Netgear routers
* routers with broken HTTPS

If these work, most routers should work.

---

# Future Expansion Ideas

## Automation

Add:

* auto-login
* scripted configuration
* reboot workflows
* firmware flashing

Using Playwright automation APIs.

---

# Potential Future Improvements

* delta frame updates
* browser reuse pools
* multi-user support
* recording/replay
* OCR
* AI-assisted automation
* WebRTC streaming

These are intentionally out of scope for MVP.

---

# Important Design Principle

This is NOT a generic remote desktop system.

It is:

* a lightweight remote browser control system
* optimized specifically for router admin interfaces
* intended for router labs and automation environments

Keep the architecture simple and focused.

---

# Stream Optimization Backlog

## Frame Deduplication (highest impact)

Router UIs are mostly static (forms, tables, menus). Currently *every* CDP frame is processed and sent even if the page hasn't changed.

**Approach:** Compare consecutive frames — skip encoding/sending when the page is identical.

Options for comparison:
- **Perceptual hash (pHash):** Compute a hash of each frame, skip if hash matches previous. Fast, immune to minor JPEG noise changes.
- **Block-level pixel diff:** Downscale frame to e.g. 16×16, compare average channel values per block.
- **CDP metadata:** Check `metadata.pageScaleFactor`, `metadata.deviceWidth`, `metadata.scrollOffsetX/Y` — if none of these changed, the frame may be redundant.

With a static router page, this should drop 90%+ of frames.

**Implementation notes:**
- Track the last-sent WebP buffer or a hash of it
- On new frame, compare hash before encoding; skip if identical
- Optionally send a "frame-skipped" event so the frontend controls (like the frame indicator) stay accurate

## Sharp Encoder Tuning

Current default `effort: 4` is balanced for file size vs speed. For real-time streaming, `effort: 0` is preferred:

```js
.webp({ quality: this.screencastQuality, effort: 0 })
```

| `effort` | Encode speed | File size vs `effort: 6` |
|----------|-------------|--------------------------|
| 0 | ~3-5x faster | +10-15% |
| 4 (default) | baseline | baseline |
| 6 | ~2x slower | -5-10% |

For router UIs at 1-5 fps, `effort: 0` keeps CPU low with negligible size penalty.

## Frame Throttling via CDP

Current `everyNthFrame: 1` captures every compositor frame. Router UIs don't need high frame rates — `everyNthFrame: 2` or `3` halves/triples the frame pipeline throughput:

```js
everyNthFrame: 2   // ~15 fps max → ~7-8 fps
```

This directly reduces:
- CDP encoding work in Chromium
- WebP transcoding on the backend
- Socket.IO messages sent to frontend
- Canvas decode/draw cycles in the browser

## Adaptive CDP Source Quality

Since CDP JPEG is an intermediate source (transcoded to WebP before reaching the frontend), its quality can be lowered independently:

```js
format: 'jpeg',
quality: 50,   // lower source quality; WebP handles the final visual
```

This reduces CDP→Node transfer size and sharp decode time with no visible difference to the user (WebP compression hides the source artifacts).
