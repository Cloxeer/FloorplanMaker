// storage.test.js — projectSignature drives save de-duplication: two states
// that persist the same bytes must share a signature (so the physical write is
// skipped), and any real change must produce a different one (so it is written).
import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSignature } from '../js/store/autosave.js';

function sampleProject() {
  return {
    id: 'abc',
    slug: 'hjlc-1',
    name: 'HJLC',
    createdAt: 1000,
    savedAt: 2000,
    doc: { version: 1, meta: { building: 'HJLC', floor: 1 }, floor: null, items: [], sections: [] },
    photo: { dataUrl: 'data:image/jpeg;base64,AAAA', width: 800, height: 600, corners: [[0, 0]] },
    view: { zoom: 1, panX: 0, panY: 0, onion: 0.5 },
    history: { past: [], future: [] },
  };
}

test('identical content yields identical signature', () => {
  assert.equal(projectSignature(sampleProject()), projectSignature(sampleProject()));
});

test('fields that must not trigger a rewrite are ignored', () => {
  const base = sampleProject();
  const sig = projectSignature(base);
  // savedAt changes on every write; id/createdAt/history are not persisted
  // content that should force a rewrite on its own.
  const varied = { ...base, savedAt: 999999, createdAt: 5, id: 'zzz', history: { past: ['x', 'y'], future: ['z'] } };
  assert.equal(projectSignature(varied), sig);
});

test('a document edit changes the signature', () => {
  const base = sampleProject();
  const edited = { ...base, doc: { ...base.doc, items: [{ id: 'r1', type: 'room', x: 1, y: 2, w: 3, h: 4 }] } };
  assert.notEqual(projectSignature(edited), projectSignature(base));
});

test('a view change changes the signature', () => {
  const base = sampleProject();
  const panned = { ...base, view: { ...base.view, panX: 42 } };
  assert.notEqual(projectSignature(panned), projectSignature(base));
});

test('a new photo changes the signature; identity of an unchanged photo does not', () => {
  const base = sampleProject();
  // Re-straighten produces a different JPEG -> different length -> different sig.
  const rephotographed = { ...base, photo: { ...base.photo, dataUrl: 'data:image/jpeg;base64,BBBBBBBB' } };
  assert.notEqual(projectSignature(rephotographed), projectSignature(base));
  // Same photo bytes reached through a fresh object still dedups.
  const samePhoto = { ...base, photo: { dataUrl: 'data:image/jpeg;base64,AAAA', width: 800, height: 600, corners: [[9, 9]] } };
  assert.equal(projectSignature(samePhoto), projectSignature(base));
});

test('projects with and without a photo differ, and null is handled', () => {
  const base = sampleProject();
  const noPhoto = { ...base, photo: null };
  assert.notEqual(projectSignature(noPhoto), projectSignature(base));
  assert.equal(projectSignature(null), '');
});
