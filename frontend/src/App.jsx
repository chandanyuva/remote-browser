import { useEffect, useRef, useState } from 'react';
import { socket } from './socket.js';

const EMPTY_SESSION = { active: false, ownerId: null, viewport: { width: 1280, height: 720 } };

export default function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [session, setSession] = useState(EMPTY_SESSION);
  const [url, setUrl] = useState('http://192.168.1.1');
  const [pageStatus, setPageStatus] = useState({ title: '', url: '' });
  const [frameUrl, setFrameUrl] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const frameRef = useRef('');
  const imageRef = useRef(null);

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
        replaceFrame('');
      }
    };
    const onFrame = (data) => {
      const blob = new Blob([data], { type: 'image/jpeg' });
      replaceFrame(URL.createObjectURL(blob));
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
    const replaceFrame = (next) => {
      if (frameRef.current) URL.revokeObjectURL(frameRef.current);
      frameRef.current = next;
      setFrameUrl(next);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('session-state', onState);
    socket.on('frame', onFrame);
    socket.on('page-status', onPageStatus);
    socket.on('error-message', onError);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('session-state', onState);
      socket.off('frame', onFrame);
      socket.off('page-status', onPageStatus);
      socket.off('error-message', onError);
      if (frameRef.current) URL.revokeObjectURL(frameRef.current);
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
    const rect = imageRef.current.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * session.viewport.width,
      y: ((event.clientY - rect.top) / rect.height) * session.viewport.height
    };
  }

  function sendClick(event) {
    if (!ownsSession) return;
    socket.emit('mouse-click', coordinates(event));
    imageRef.current?.focus();
  }

  function sendMove(event) {
    if (!ownsSession) return;
    socket.volatile.emit('mouse-move', coordinates(event));
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
            {frameUrl ? (
              <img
                ref={imageRef}
                src={frameUrl}
                alt="Remote router browser"
                tabIndex={0}
                onClick={sendClick}
                onMouseMove={sendMove}
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
            <span>{frameUrl ? 'Live JPEG stream' : 'No frame data'}</span>
          </footer>
        </section>
      </section>
    </main>
  );
}
