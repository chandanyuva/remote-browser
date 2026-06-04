import { useEffect, useRef, useState } from 'react';
import { socket } from './socket.js';

const EMPTY_SESSION = { active: false, ownerId: null, viewport: { width: 1280, height: 720 } };

export default function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [session, setSession] = useState(EMPTY_SESSION);
  const [url, setUrl] = useState('http://192.168.1.1');
  const [pageStatus, setPageStatus] = useState({ title: '', url: '' });
  const [hasFrame, setHasFrame] = useState(false);
  const [cursor, setCursor] = useState('default');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const canvasRef = useRef(null);
  const frameGenerationRef = useRef(0);
  const pendingFrameRef = useRef(null);
  const decodingFrameRef = useRef(false);
  const pendingMoveRef = useRef(null);
  const moveFrameRef = useRef(null);

  const ownsSession = session.active && session.ownerId === socket.id;

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => {
      setConnected(false);
      setStarting(false);
    };
    const onState = (next) => {
      setSession(next);
      setStarting(false);
      if (!next.active) {
        setPageStatus({ title: '', url: '' });
        setCursor('default');
        clearFrame();
      }
    };
    const drawNextFrame = async () => {
      if (decodingFrameRef.current || !pendingFrameRef.current) return;

      const image = pendingFrameRef.current;
      const generation = frameGenerationRef.current;
      pendingFrameRef.current = null;
      decodingFrameRef.current = true;
      const bitmap = await createImageBitmap(new Blob([image], { type: 'image/webp' })).catch(() => null);
      if (bitmap) {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (generation === frameGenerationRef.current && canvas && context) {
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          setHasFrame(true);
        }
        bitmap.close();
      }
      decodingFrameRef.current = false;
      drawNextFrame();
    };
    const onFrame = ({ image }) => {
      pendingFrameRef.current = image;
      drawNextFrame();
    };
    const onPageStatus = (status) => {
      setPageStatus((current) => ({ ...current, ...status }));
      if (status.url) setUrl(status.url);
      if (status.title !== null) setStarting(false);
    };
    const onError = (message) => {
      setError(message);
      setStarting(false);
    };
    const onCursorStyle = (nextCursor) => setCursor(nextCursor || 'default');
    const clearFrame = () => {
      frameGenerationRef.current += 1;
      pendingFrameRef.current = null;
      if (moveFrameRef.current) cancelAnimationFrame(moveFrameRef.current);
      const canvas = canvasRef.current;
      canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      setHasFrame(false);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('session-state', onState);
    socket.on('frame', onFrame);
    socket.on('page-status', onPageStatus);
    socket.on('error-message', onError);
    socket.on('cursor-style', onCursorStyle);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('session-state', onState);
      socket.off('frame', onFrame);
      socket.off('page-status', onPageStatus);
      socket.off('error-message', onError);
      socket.off('cursor-style', onCursorStyle);
      frameGenerationRef.current += 1;
      pendingFrameRef.current = null;
    };
  }, []);

  function startSession(event) {
    event.preventDefault();
    setError('');
    setStarting(true);
    socket.emit(session.active ? 'navigate' : 'session-create', { url });
  }

  function closeSession() {
    socket.emit('session-close');
  }

  function coordinates(event) {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * session.viewport.width,
      y: ((event.clientY - rect.top) / rect.height) * session.viewport.height
    };
  }

  function sendClick(event) {
    if (!ownsSession) return;
    socket.emit('mouse-click', coordinates(event));
    canvasRef.current?.focus();
  }

  function sendMove(event) {
    if (!ownsSession) return;
    pendingMoveRef.current = coordinates(event);
    if (moveFrameRef.current) return;

    moveFrameRef.current = requestAnimationFrame(() => {
      socket.volatile.emit('mouse-move', pendingMoveRef.current);
      moveFrameRef.current = null;
    });
  }

  function sendScroll(event) {
    if (!ownsSession) return;
    socket.emit('mouse-wheel', { deltaX: event.deltaX, deltaY: event.deltaY });
  }

  function sendKey(event, type) {
    if (!ownsSession) return;
    event.preventDefault();
    socket.emit(type, { key: event.key });
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><span /></div>
          <div>
            <p>Router Relay</p>
            <span>Backend-isolated browser control</span>
          </div>
        </div>
        <div className={`connection ${connected ? 'online' : ''}`}>
          <i />
          {connected ? 'Relay online' : 'Relay offline'}
        </div>
      </header>

      <section className="workspace">
        <div className="intro">
          <div>
            <span className="eyebrow">Secure control plane</span>
            <h1>Router access,<br /><em>kept behind the relay.</em></h1>
          </div>
          <p>The target router is opened only by the backend Chromium session. Your browser receives pixels and sends input events.</p>
        </div>

        <form className="address-bar" onSubmit={startSession}>
          <span className="protocol">HTTP<span>S</span></span>
          <input
            aria-label="Router address"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="192.168.1.1"
            disabled={!connected || (session.active && !ownsSession)}
          />
          <button disabled={!connected || starting || (session.active && !ownsSession)}>
            {starting ? 'Connecting…' : session.active ? 'Navigate' : 'Open session'}
          </button>
          {ownsSession && <button type="button" className="stop" onClick={closeSession}>Close</button>}
        </form>

        {error && <div className="alert" role="alert">{error}<button onClick={() => setError('')}>Dismiss</button></div>}

        <section className="browser-panel">
          <div className="browser-chrome">
            <div className="lights"><i /><i /><i /></div>
            <div className="page-title">{pageStatus.title || (session.active ? 'Loading router interface…' : 'No active session')}</div>
            <div className="viewport-label">1280 × 720</div>
          </div>

          <div className="screen">
            {session.active && ownsSession ? (
              <canvas
                ref={canvasRef}
                width={session.viewport.width}
                height={session.viewport.height}
                aria-label="Remote router browser"
                style={{ cursor }}
                tabIndex={0}
                onClick={sendClick}
                onMouseMove={sendMove}
                onWheel={sendScroll}
                onKeyDown={(event) => sendKey(event, 'keydown')}
                onKeyUp={(event) => sendKey(event, 'keyup')}
              />
            ) : (
              <div className="empty-state">
                <div className="radar"><i /><i /><span /></div>
                <h2>{session.active ? 'Session occupied' : 'Ready to establish a relay'}</h2>
                <p>{session.active ? 'Another client currently controls the browser session.' : 'Enter a router address above to start streaming its admin interface.'}</p>
              </div>
            )}
          </div>

          <footer className="statusbar">
            <span><i className={session.active ? 'active' : ''} />{session.active ? ownsSession ? 'Session active' : 'Session occupied' : 'Standing by'}</span>
            <code>{pageStatus.url || 'Backend browser disconnected'}</code>
            <span>{hasFrame ? 'Live CDP screencast' : 'No frame data'}</span>
          </footer>
        </section>
      </section>
    </main>
  );
}
