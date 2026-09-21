// route.worker.js
// Module worker wrapper around js/model/route.js so pathfinding runs off the
// main thread. Depends on: ../model/route.js.
//
// Messages in:
//   { id, kind:'route', doc, roomId, cell } -> posts { id, kind:'route', result }
//   { id, kind:'all',   doc, cell }         -> posts { id, kind:'all', result }
// On error: posts { id, error: message }

import { routeToRoom, routeAll } from '../model/route.js';

self.onmessage = (e) => {
  const msg = e.data || {};
  const { id, kind } = msg;
  try {
    if (kind === 'route') {
      const result = routeToRoom(msg.doc, msg.roomId, msg.cell);
      self.postMessage({ id, kind: 'route', result });
    } else if (kind === 'all') {
      const result = routeAll(msg.doc, msg.cell);
      self.postMessage({ id, kind: 'all', result });
    } else {
      self.postMessage({ id, error: `unknown kind: ${kind}` });
    }
  } catch (err) {
    self.postMessage({ id, error: err && err.message ? err.message : String(err) });
  }
};
