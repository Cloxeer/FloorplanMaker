// buildingExport.js (view)
// Gets every floor of the building ready for "All floors" preview and export: the saved plan of each
// floor, its finished SVG for a given page, and how many errors still block it.
// Depends on: js/view/panels/floors.js (loadFloorProjects), js/model/validate.js, js/model/svgExport.js,
// js/model/pageFit.js, js/store/autosave.js.

import { loadFloorProjects } from './panels/floors.js';
import { validate } from '../model/validate.js';
import { exportSvg } from '../model/svgExport.js';
import { contentBounds, pageFrame, applyFrame } from '../model/pageFit.js';
import { exportProjectJson } from '../store/autosave.js';

// -> [{ floor, slug, current, project, doc, errors, empty, svgFor(page), projectJson(), photo }] lowest floor first
export async function prepareBuilding(app) {
  const list = await loadFloorProjects(app);
  return list.map((f) => {
    const doc = f.project.doc;
    const empty = !(doc.items && doc.items.length) && !(doc.floor && doc.floor.points);
    let errors = 0, raw = '';
    if (!empty) {
      try { errors = validate(doc).filter((r) => r.level === 'error').length; raw = exportSvg(doc); } catch (e) { errors = 1; }
    }
    return {
      floor: f.floor, slug: f.slug, current: f.current, project: f.project, doc, errors, empty,
      svgFor: (page) => (raw ? applyFrame(raw, pageFrame(contentBounds(doc), page, 'auto', {})) : ''),
      projectJson: () => exportProjectJson(f.project),
      photo: f.project.photo && f.project.photo.dataUrl ? f.project.photo.dataUrl : null,
    };
  });
}
