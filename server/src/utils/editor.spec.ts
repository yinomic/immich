import { describe, expect, it } from 'vitest';
import { boundingBoxOverlap } from 'src/utils/editor.js';

describe('boundingBoxOverlap', () => {
  it('should return 1 for identical boxes', () => {
    const box = { x1: 0, y1: 0, x2: 100, y2: 100 };
    expect(boundingBoxOverlap(box, box)).toBe(1);
  });

  it('should return 0 for non-overlapping boxes', () => {
    const boxA = { x1: 0, y1: 0, x2: 100, y2: 100 };
    const boxB = { x1: 200, y1: 200, x2: 300, y2: 300 };
    expect(boundingBoxOverlap(boxA, boxB)).toBe(0);
  });

  it('should return 0.5 for 50% overlap', () => {
    const boxA = { x1: 0, y1: 0, x2: 100, y2: 100 };
    const boxB = { x1: 50, y1: 0, x2: 150, y2: 100 };
    expect(boundingBoxOverlap(boxA, boxB)).toBe(0.5);
  });

  it('should return 0.25 for 25% overlap', () => {
    const boxA = { x1: 0, y1: 0, x2: 100, y2: 100 };
    const boxB = { x1: 50, y1: 50, x2: 150, y2: 150 };
    expect(boundingBoxOverlap(boxA, boxB)).toBe(0.25);
  });

  it('should return 1 when boxA is fully contained in boxB', () => {
    const boxA = { x1: 25, y1: 25, x2: 75, y2: 75 };
    const boxB = { x1: 0, y1: 0, x2: 100, y2: 100 };
    expect(boundingBoxOverlap(boxA, boxB)).toBe(1);
  });
});
