// canvasInput.js
// Pointer/wheel gesture handling for canvas.js: wheel zoom around the cursor,
// space+drag or middle-button pan, two-pointer pinch zoom+pan on touch, and
// delegation of plain down/move/up/cancel to tool handlers (via onPointer).
// Kept separate from canvas.js to stay under the 400-line budget.
// Depends on: nothing (pure DOM event wiring).

export function attachCanvasInput(svgEl, on, ctx) {
  // ctx: { getView, setView, applyViewBox, getClientRect, toPlan }
  const handlers = [];
  function onPointer(handler) {
    handlers.push(handler);
  }
  function dispatch(kind, e, pt) {
    for (const h of handlers) h(kind, e, pt);
  }

  function screenDistance(p1, p2) {
    const dx = p1.x - p2.x, dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  const pointers = new Map(); // pointerId -> {x,y}
  let spaceDown = false;
  let panning = false;
  let panStart = null; // {clientX, clientY, view}
  let pinchStart = null; // {dist, center, view}

  on(window, 'keydown', (e) => {
    if (e.code === 'Space') spaceDown = true;
  });
  on(window, 'keyup', (e) => {
    if (e.code === 'Space') spaceDown = false;
  });

  on(svgEl, 'wheel', (e) => {
    e.preventDefault();
    const view = ctx.getView();
    const rect = ctx.getClientRect();
    const cx = view.x + ((e.clientX - rect.left) / rect.width) * view.w;
    const cy = view.y + ((e.clientY - rect.top) / rect.height) * view.h;
    const factor = Math.exp(e.deltaY * 0.001);
    const newW = view.w * factor;
    const newH = view.h * factor;
    ctx.setView({
      x: cx - ((cx - view.x) / view.w) * newW,
      y: cy - ((cy - view.y) / view.h) * newH,
      w: newW,
      h: newH,
    });
  }, { passive: false });

  on(svgEl, 'pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svgEl.setPointerCapture(e.pointerId);

    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      pinchStart = {
        dist: screenDistance(pts[0], pts[1]),
        center: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
        view: ctx.getView(),
      };
      panning = false;
      return;
    }

    const isMiddle = e.button === 1;
    if (spaceDown || isMiddle) {
      panning = true;
      panStart = { clientX: e.clientX, clientY: e.clientY, view: ctx.getView() };
      return;
    }
    dispatch('down', e, ctx.toPlan(e.clientX, e.clientY));
  });

  on(svgEl, 'pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2 && pinchStart) {
      const pts = [...pointers.values()];
      const d = screenDistance(pts[0], pts[1]);
      const center = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const scale = pinchStart.dist > 0 ? d / pinchStart.dist : 1;
      const rect = ctx.getClientRect();
      const startPlanCx = pinchStart.view.x + ((pinchStart.center.x - rect.left) / rect.width) * pinchStart.view.w;
      const startPlanCy = pinchStart.view.y + ((pinchStart.center.y - rect.top) / rect.height) * pinchStart.view.h;
      const newW = pinchStart.view.w / scale;
      const newH = pinchStart.view.h / scale;
      const dxScreen = center.x - pinchStart.center.x;
      const dyScreen = center.y - pinchStart.center.y;
      const dxPlan = (dxScreen / rect.width) * newW;
      const dyPlan = (dyScreen / rect.height) * newH;
      ctx.setView({
        x: startPlanCx - newW / 2 - dxPlan,
        y: startPlanCy - newH / 2 - dyPlan,
        w: newW,
        h: newH,
      });
      return;
    }

    if (panning && panStart) {
      const rect = ctx.getClientRect();
      const dx = ((e.clientX - panStart.clientX) / rect.width) * panStart.view.w;
      const dy = ((e.clientY - panStart.clientY) / rect.height) * panStart.view.h;
      ctx.setView({ ...panStart.view, x: panStart.view.x - dx, y: panStart.view.y - dy });
      return;
    }

    dispatch('move', e, ctx.toPlan(e.clientX, e.clientY));
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (panning && pointers.size === 0) {
      panning = false;
      panStart = null;
      return;
    }
    if (pointers.size === 0 && !panning) {
      dispatch('up', e, ctx.toPlan(e.clientX, e.clientY));
    }
  }

  on(svgEl, 'pointerup', endPointer);
  on(svgEl, 'pointercancel', (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (panning) {
      panning = false;
      panStart = null;
    }
    dispatch('cancel', e, ctx.toPlan(e.clientX, e.clientY));
  });

  return { onPointer };
}
