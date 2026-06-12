# Router Relay Prototype

A backend-isolated remote browser for router administration. The backend opens the router in Playwright Chromium, streams frames through a CDP screencast (JPEG source → WebP transcoded), renders them on a canvas, and forwards mouse and keyboard input. The canvas mirrors the cursor style of the remote page under the pointer.

## Run locally

```bash
npm install
npx playwright install chromium
npm run dev
```

Open `http://localhost:5173`, enter a router URL, and select **Open session**.

For a production-style run:

```bash
npm run build
npm start
```

Then open `http://localhost:3001`.

## Configuration

Copy `.env.example` values into your environment as needed:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Backend HTTP/WS port |
| `HEADLESS` | `true` | Set to `false` to see the backend browser window |
| `SCREENCAST_QUALITY` | `75` | WebP output quality (0–100) sent to the frontend |
| `SCREENCAST_CDP_QUALITY` | `50` | CDP JPEG source quality (0–100); lower than WebP quality to reduce transfer size — WebP compression hides the source artifacts |

## Stream Optimizations

All four optimizations from the backlog are implemented:

- **Frame deduplication** — MD5 hash of raw CDP JPEG buffer; identical frames are skipped before WebP transcoding and socket emit. Router UIs are mostly static, so ~90% of frames are dropped.
- **Sharp `effort: 0`** — fastest WebP encoding mode (~3-5x faster than default `effort: 4`) with negligible size penalty.
- **`everyNthFrame: 2`** — CDP captures every other compositor frame, halving pipeline throughput without noticeable lag on router UIs.
- **Adaptive CDP quality** — CDP JPEG source quality (`SCREENCAST_CDP_QUALITY`, default `50`) is independent of WebP output quality (`SCREENCAST_QUALITY`, default `75`).

## Limitations

- One active browser session at a time (single-user)
- No authentication
- No persistent sessions or recording
- The frontend canvas must be visible for frames to render
