// pan.js
// Pan tool: drag pans the view via canvas.setView (an explicit tool for touch
// devices / a toolbar button; space+drag and middle-button pan are handled
// directly inside canvas.js). Depends on: nothing beyond app.canvas.

export function createPanTool(app) {
  let start = null; // { clientPt, view }

  function onDown(e, pt) {
    start = { x: e.clientX, y: e.clientY, view: app.canvas.getView() };
  }

  function onMove(e, pt) {
    if (!start) return;
    const rect = e.target && e.target.getBoundingClientRect ? e.target.getBoundingClientRect() : null;
    const view = start.view;
    // Convert client delta to plan delta using the view's scale.
    const svgRect = document.querySelector('svg') ? document.querySelector('svg').getBoundingClientRect() : rect;
    if (!svgRect) return;
    const dxScreen = e.clientX - start.x;
    const dyScreen = e.clientY - start.y;
    const dx = (dxScreen / svgRect.width) * view.w;
    const dy = (dyScreen / svgRect.height) * view.h;
    app.canvas.setView({ x: view.x - dx, y: view.y - dy });
  }

  function onUp() {
    start = null;
  }

  function onKey() { return false; }
  function cancel() { start = null; }

  return {
    name: 'pan',
    hint: 'Drag to pan the view.',
    onDown,
    onMove,
    onUp,
    onKey,
    cancel,
  };
}
