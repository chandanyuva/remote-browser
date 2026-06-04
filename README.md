# Router Relay Prototype

A backend-isolated remote browser for router administration. The backend opens the router in Playwright Chromium, streams JPEG frames through a CDP screencast, renders them on a canvas, and forwards mouse and keyboard input. The canvas mirrors the cursor style of the remote page under the pointer.

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

- `PORT`: backend port, default `3001`
- `HEADLESS`: set to `false` to see the backend browser
- `SCREENCAST_QUALITY`: WebP encoding quality (and CDP JPEG source quality) from 0–100, default `75`

The prototype supports one active browser session. Closing the frontend also closes its backend browser session.
