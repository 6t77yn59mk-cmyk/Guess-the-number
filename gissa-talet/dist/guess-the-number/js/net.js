// Connection to the game server (ONLINE and PARTY modes).
// The server runs on the same address as the game (python server.py), or somewhere else that
// js/config.js points to (the CrazyGames version).
import { GAME_SERVER } from './config.js';

const url = () => (GAME_SERVER
  ? `${GAME_SERVER.replace(/^http/, 'ws').replace(/\/+$/, '')}/ws`
  : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);

// A free hosted server falls asleep when nobody has played for a while and needs up to a
// minute to wake up, so then we keep trying for a while. Our own server answers right away.
const ATTEMPT_MS = 8000;
const GIVE_UP_MS = GAME_SERVER ? 75000 : 6000;

export function createConnection({ onMessage, onClose }) {
  let socket = null;
  let pending = null;

  // One try at connecting
  function attempt() {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(url());
      } catch (err) {
        reject(err);
        return;
      }
      let connected = false;
      const timer = setTimeout(() => ws.close(), Math.min(ATTEMPT_MS, GIVE_UP_MS));
      ws.onopen = () => {
        connected = true;
        clearTimeout(timer);
        socket = ws;
        resolve();
      };
      ws.onmessage = event => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        onMessage(message);
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (!connected) {
          reject(new Error('Could not reach the game server'));
          return;
        }
        if (socket === ws) socket = null;
        onClose();
      };
    });
  }

  async function connect() {
    if (!GAME_SERVER && location.protocol === 'file:') throw new Error('The game was opened as a file');
    // A plain request is what wakes a sleeping hosted server up
    if (GAME_SERVER) fetch(GAME_SERVER, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
    const start = performance.now();
    for (;;) {
      try {
        await attempt();
        return;
      } catch (err) {
        if (performance.now() - start + 2000 > GIVE_UP_MS) throw err;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  function open() {
    if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve();
    if (!pending) pending = connect().finally(() => { pending = null; });
    return pending;
  }

  function send(message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  return {
    open,
    send,
    get connected() {
      return Boolean(socket && socket.readyState === WebSocket.OPEN);
    },
  };
}
