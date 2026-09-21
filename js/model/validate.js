// validate.js — pure validation of a floorplan doc against the BetterNMSUMaps
// SVG dialect rules (docs/DIALECT.md). No DOM, no window.
// Depends on: ./geometry.js (isOnOutline, dist), ./document.js (roomPolygon,
// labelPos, NUMBER_RE, getItem).
//
// validate(doc) -> [{ level:'error'|'warning', code, message, itemId? }]
// Errors are sorted before warnings; each group preserves discovery order.

import { isOnOutline, dist, pointInPolygon, polygonsOverlap } from './geometry.js';
import { roomPolygon, labelPos, NUMBER_RE } from './document.js';

function roomLabel(item) {
  return item.number || item.id;
}

export function validate(doc) {
  const errors = [];
  const warnings = [];

  const floor = doc.floor;
  const hasFloor = !!(floor && Array.isArray(floor.points) && floor.points.length > 0);

  if (!hasFloor) {
    errors.push({ level: 'error', code: 'no-floor', message: 'No floor outline has been drawn yet.' });
  } else if (floor.points.length < 3) {
    errors.push({
      level: 'error',
      code: 'floor-not-closed',
      message: 'The floor outline has fewer than 3 points and is not closed.',
    });
  }

  for (const p of doc.problems || []) {
    if (p.code === 'transform-present') {
      errors.push({ level: 'error', code: 'transform-present', message: p.message || 'A transform attribute is present outside the compass.' });
    }
  }

  const numbersSeen = new Map(); // number -> first itemId

  for (const item of doc.items) {
    if (item.type === 'room') {
      const isVoid = item.cls === 'void';

      if (!isVoid) {
        if (!item.number) {
          errors.push({
            level: 'error',
            code: 'room-no-number',
            message: `Room ${roomLabel(item)} has no room number.`,
            itemId: item.id,
          });
        } else if (!NUMBER_RE.test(item.number)) {
          errors.push({
            level: 'error',
            code: 'bad-number-format',
            message: `Room ${roomLabel(item)} has a number "${item.number}" that doesn't match the expected format.`,
            itemId: item.id,
          });
        } else {
          if (numbersSeen.has(item.number)) {
            errors.push({
              level: 'error',
              code: 'duplicate-number',
              message: `Room number ${item.number} is used more than once.`,
              itemId: item.id,
            });
          } else {
            numbersSeen.set(item.number, item.id);
          }
        }
      } else if (item.number || item.name) {
        errors.push({
          level: 'error',
          code: 'void-with-label',
          message: `Void room ${roomLabel(item)} should not have a number or name.`,
          itemId: item.id,
        });
      }

      if (!isVoid) {
        const pos = labelPos(item);
        const poly = roomPolygon(item);
        if (!pointInPolygon([pos.x, pos.y], poly)) {
          errors.push({
            level: 'error',
            code: 'label-outside-shape',
            message: `The label for room ${roomLabel(item)} falls outside its shape.`,
            itemId: item.id,
          });
        }
        if (item.label && typeof item.label.fontSize === 'number' && item.label.fontSize < 12) {
          warnings.push({
            level: 'warning',
            code: 'label-tiny',
            message: `The label for room ${roomLabel(item)} has a very small font size.`,
            itemId: item.id,
          });
        }
      }
    }

    if (item.type === 'door') {
      if (!hasFloor) {
        errors.push({
          level: 'error',
          code: 'door-no-floor',
          message: 'A door exists but there is no floor outline for it to sit on.',
          itemId: item.id,
        });
      } else {
        const seg = { x1: item.x1, y1: item.y1, x2: item.x2, y2: item.y2 };
        if (!isOnOutline(seg, floor.points)) {
          errors.push({
            level: 'error',
            code: 'door-off-outline',
            message: 'A door is not positioned on the floor outline.',
            itemId: item.id,
          });
        }
      }

      const mid = { x: (item.x1 + item.x2) / 2, y: (item.y1 + item.y2) / 2 };
      const labelPt = item.label || {};
      const d = (typeof labelPt.x === 'number' && typeof labelPt.y === 'number')
        ? dist([mid.x, mid.y], [labelPt.x, labelPt.y])
        : Infinity;
      if (d > 100) {
        errors.push({
          level: 'error',
          code: 'door-no-exit-label',
          message: 'A door has no EXIT/Door label near it.',
          itemId: item.id,
        });
      }
    }
  }

  // overlapping-rooms: pairwise check, one entry per pair, itemId = first
  const rooms = doc.items.filter((i) => i.type === 'room');
  for (let a = 0; a < rooms.length; a++) {
    for (let b = a + 1; b < rooms.length; b++) {
      const polyA = roomPolygon(rooms[a]);
      const polyB = roomPolygon(rooms[b]);
      if (polygonsOverlap(polyA, polyB)) {
        warnings.push({
          level: 'warning',
          code: 'overlapping-rooms',
          message: `Rooms ${roomLabel(rooms[a])} and ${roomLabel(rooms[b])} overlap.`,
          itemId: rooms[a].id,
        });
      }
    }
  }

  return errors.concat(warnings);
}
