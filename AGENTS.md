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

# Implementation Status (Phase 1–3 complete)

## Backend (`backend/server.js` + `backend/browserManager.js`)

| Component | Status |
|---|---|
| Express + Socket.IO server | ✅ Done |
| Playwright Chromium launch (headless/headed) | ✅ Done |
| CDP screencast (JPEG source → WebP output) | ✅ Done |
| Mouse click / move / wheel injection | ✅ Done |
| Keyboard down / up injection | ✅ Done |
| Cursor style mirroring via `elementFromPoint` | ✅ Done |
| Coordinate clamping to viewport | ✅ Done |
| Session ownership enforcement (`ownerId`) | ✅ Done |
| Graceful cleanup on disconnect / shutdown | ✅ Done |
| Health endpoint (`GET /api/health`) | ✅ Done |
| SPA fallback for static serving | ✅ Done |

## Frontend (`frontend/src/App.jsx`)

| Component | Status |
|---|---|
| Canvas frame rendering with `createImageBitmap` | ✅ Done |
| Sequential frame decode with backpressure lock | ✅ Done |
| Debounced mouse-move via `requestAnimationFrame` | ✅ Done |
| Volatile emit for mouse-move (no queue buildup) | ✅ Done |
| Coordinate scaling (display coords → viewport coords) | ✅ Done |
| Cursor CSS mirroring on canvas | ✅ Done |
| Session state UI (active/occupied/standing by) | ✅ Done |
| Error display with dismiss | ✅ Done |

## Stream Optimizations

| Optimization | Status | Details |
|---|---|---|
| Frame deduplication (MD5 hash comparison) | ✅ Done | Skips WebP encode + emit for identical frames |
| Sharp `effort: 0` | ✅ Done | Fastest WebP encoding mode |
| `everyNthFrame: 2` | ✅ Done | Captures every other compositor frame |
| Adaptive CDP quality | ✅ Done | CDP JPEG quality independent from WebP output quality |

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

# Stream Optimizations

All optimizations in this section are implemented unless marked as backlog.

## Completed

### Frame Deduplication (highest impact)

Router UIs are mostly static (forms, tables, menus). MD5 hash of the raw CDP JPEG buffer is computed before transcoding. If it matches the previous frame, WebP encoding and socket emit are skipped entirely.

**Implementation:** `browserManager.js:153-156` — hashes raw JPEG buffer, skips sharp + emit on match, reset on new CDP session.

### Sharp Encoder Tuning

```js
.webp({ quality: this.screencastQuality, effort: 0 })
```

`effort: 0` is ~3-5x faster than the default `effort: 4` with only +10-15% file size penalty, which is negligible for router UIs at 1-5 fps.

### Frame Throttling via CDP

```js
everyNthFrame: 2   // ~15 fps max → ~7-8 fps
```

Halves the pipeline throughput:
- CDP encoding work in Chromium
- WebP transcoding on the backend
- Socket.IO messages sent to frontend
- Canvas decode/draw cycles in the browser

### Adaptive CDP Source Quality

CDP JPEG quality is independent from WebP output quality:

| Variable | Default | Role |
|---|---|---|
| `SCREENCAST_CDP_QUALITY` | `50` | CDP JPEG source (lower = smaller transfer) |
| `SCREENCAST_QUALITY` | `75` | WebP output sent to frontend |

Reduces CDP→Node transfer size with no visible difference — WebP compression hides source artifacts.

## Backlog (Future)

### Cursor Evaluation Caching (high impact)

`cursorAtPoint` calls `document.elementFromPoint` + `getComputedStyle` on **every** mouse-move (15–60 calls/sec). The pointer rarely lands on a new element between moves.

**Approach:** Cache the cursor result keyed by rounded coordinates (e.g., bucket to 5px grid). Invalidate on click or after 2s. This eliminates the most expensive per-frame backend operation.

### Mouse-Move Coalescing (medium impact)

Multiple volatile mouse-move events can queue at the backend before one resolves. Only the last position matters.

**Approach:** Debounce `page.mouse.move` + cursor eval in `server.js` so only the most recent coordinates are processed per animation frame.

### Tab Visibility Pausing (medium impact)

When the browser tab is hidden or the canvas is scrolled out of view, frames are still decoded and drawn.

**Approach:** Use `document.visibilitychange` + `IntersectionObserver` in the frontend to skip frame processing. The backend continues producing frames, but the frontend drops them. Optionally signal the backend to reduce quality or throttle further while hidden.

### Socket.IO per-message deflate (low impact)

Enable `perMessageDeflate: true` on the Socket.IO server to compress text events (cursor-style, page-status, session-state) at minimal CPU cost.

### Frame quality step-down on idle (low impact)

If no mouse/keyboard events for N seconds, lower CDP quality or bump `everyNthFrame`. Restore on next interaction. Reduces bandwidth during viewing-only periods.
