import { describe, expect, it } from 'vitest';
import { AssetOcrResponseDto } from 'src/dtos/ocr.dto.js';
import { SourceType } from 'src/enum.js';
import { boundingBoxOverlap, checkOcrVisibility } from 'src/utils/editor.js';

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

  it('should handle partial containment correctly', () => {
    const boxA = { x1: 0, y1: 0, x2: 100, y2: 100 };
    const boxB = { x1: 25, y1: 25, x2: 75, y2: 75 };
    // boxB is fully inside boxA, so overlap area is 50*50=2500, boxA area is 10000
    expect(boundingBoxOverlap(boxA, boxB)).toBe(0.25);
  });

  it('should handle boxes that touch at edges (no overlap)', () => {
    const boxA = { x1: 0, y1: 0, x2: 100, y2: 100 };
    const boxB = { x1: 100, y1: 0, x2: 200, y2: 100 };
    expect(boundingBoxOverlap(boxA, boxB)).toBe(0);
  });

  it('should handle vertical partial overlap', () => {
    const boxA = { x1: 0, y1: 0, x2: 100, y2: 100 };
    const boxB = { x1: 0, y1: 50, x2: 100, y2: 150 };
    expect(boundingBoxOverlap(boxA, boxB)).toBe(0.5);
  });
});

const createOcr = (
  params: Partial<AssetOcrResponseDto & { isVisible: boolean }> = {},
): AssetOcrResponseDto & { isVisible: boolean } => ({
  id: 'ocr-id',
  assetId: 'asset-id',
  x1: 0.1,
  y1: 0.1,
  x2: 0.2,
  y2: 0.1,
  x3: 0.2,
  y3: 0.2,
  x4: 0.1,
  y4: 0.2,
  boxScore: 0.9,
  textScore: 0.9,
  text: 'Sample Text',
  isVisible: true,
  ...params,
});

describe('checkOcrVisibility', () => {
  const assetDimensions = { width: 1000, height: 1000 };

  it('should return only non-visible OCR entries when no crop is provided', () => {
    const ocrs = [
      createOcr({ id: 'ocr-1', isVisible: true }),
      createOcr({ id: 'ocr-2', isVisible: false }),
      createOcr({ id: 'ocr-3', isVisible: false }),
    ];
    const result = checkOcrVisibility(ocrs, assetDimensions);

    expect(result.visible).toHaveLength(2);
    expect(result.hidden).toHaveLength(0);
    expect(result.visible.map((o) => o.id)).toEqual(['ocr-2', 'ocr-3']);
  });

  it('should return all OCR entries as visible when all are marked not visible and no crop provided', () => {
    const ocrs = [createOcr({ id: 'ocr-1', isVisible: false }), createOcr({ id: 'ocr-2', isVisible: false })];
    const result = checkOcrVisibility(ocrs, assetDimensions);

    expect(result.visible).toHaveLength(2);
    expect(result.hidden).toHaveLength(0);
  });

  it('should return empty visible array when all OCR entries are already visible and no crop provided', () => {
    const ocrs = [createOcr({ id: 'ocr-1', isVisible: true }), createOcr({ id: 'ocr-2', isVisible: true })];
    const result = checkOcrVisibility(ocrs, assetDimensions);

    expect(result.visible).toHaveLength(0);
    expect(result.hidden).toHaveLength(0);
  });

  it('should return empty arrays when no OCR entries provided', () => {
    const result = checkOcrVisibility([], assetDimensions);

    expect(result.visible).toHaveLength(0);
    expect(result.hidden).toHaveLength(0);
  });

  it('should mark OCR as visible when fully inside crop area', () => {
    // OCR box at normalized coords 0.1-0.2 = 100-200px in 1000x1000 image
    const ocrs = [createOcr()];
    const crop = { x1: 0, y1: 0, x2: 500, y2: 500 };

    const result = checkOcrVisibility(ocrs, assetDimensions, crop);

    expect(result.visible).toHaveLength(1);
    expect(result.hidden).toHaveLength(0);
  });

  it('should mark OCR as hidden when fully outside crop area', () => {
    // OCR box at normalized coords 0.8-0.9 = 800-900px
    const ocrs = [createOcr({ x1: 0.8, y1: 0.8, x2: 0.9, y2: 0.8, x3: 0.9, y3: 0.9, x4: 0.8, y4: 0.9 })];
    const crop = { x1: 0, y1: 0, x2: 500, y2: 500 };

    const result = checkOcrVisibility(ocrs, assetDimensions, crop);

    expect(result.visible).toHaveLength(0);
    expect(result.hidden).toHaveLength(1);
  });

  it('should mark OCR as visible when at least 50% overlaps with crop', () => {
    // OCR at 100-200px (0.1-0.2 normalized), crop starts at 150
    const ocrs = [createOcr()];
    const crop = { x1: 150, y1: 100, x2: 500, y2: 500 };

    const result = checkOcrVisibility(ocrs, assetDimensions, crop);

    expect(result.visible).toHaveLength(1);
    expect(result.hidden).toHaveLength(0);
  });

  it('should mark OCR as hidden when less than 50% overlaps with crop', () => {
    // OCR at 100-200px, crop starts at 160 = 40% overlap
    const ocrs = [createOcr()];
    const crop = { x1: 160, y1: 100, x2: 500, y2: 500 };

    const result = checkOcrVisibility(ocrs, assetDimensions, crop);

    expect(result.visible).toHaveLength(0);
    expect(result.hidden).toHaveLength(1);
  });

  it('should correctly categorize multiple OCR entries', () => {
    const ocrs = [
      createOcr({ id: 'ocr-inside', x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.1, x3: 0.2, y3: 0.2, x4: 0.1, y4: 0.2 }),
      createOcr({ id: 'ocr-outside', x1: 0.8, y1: 0.8, x2: 0.9, y2: 0.8, x3: 0.9, y3: 0.9, x4: 0.8, y4: 0.9 }),
    ];
    const crop = { x1: 0, y1: 0, x2: 500, y2: 500 };

    const result = checkOcrVisibility(ocrs, assetDimensions, crop);

    expect(result.visible).toHaveLength(1);
    expect(result.hidden).toHaveLength(1);
    expect(result.visible[0].id).toBe('ocr-inside');
    expect(result.hidden[0].id).toBe('ocr-outside');
  });

  it('should handle rotated/skewed OCR polygons by using bounding box', () => {
    // Rotated rectangle - the function should compute the bounding box correctly
    const ocrs = [
      createOcr({
        id: 'ocr-rotated',
        x1: 0.15,
        y1: 0.1, // top
        x2: 0.2,
        y2: 0.15, // right
        x3: 0.15,
        y3: 0.2, // bottom
        x4: 0.1,
        y4: 0.15, // left
      }),
    ];
    const crop = { x1: 0, y1: 0, x2: 500, y2: 500 };

    const result = checkOcrVisibility(ocrs, assetDimensions, crop);

    expect(result.visible).toHaveLength(1);
    expect(result.hidden).toHaveLength(0);
  });

  it('should handle different asset dimensions', () => {
    const smallDimensions = { width: 500, height: 500 };
    // OCR at 0.1-0.2 normalized = 50-100px in 500x500 image
    const ocrs = [createOcr()];
    const crop = { x1: 0, y1: 0, x2: 200, y2: 200 };

    const result = checkOcrVisibility(ocrs, smallDimensions, crop);

    expect(result.visible).toHaveLength(1);
    expect(result.hidden).toHaveLength(0);
  });

  it('should categorize based on crop overlap when crop is provided, regardless of isVisible property', () => {
    const ocrs = [
      createOcr({ id: 'ocr-inside-visible', isVisible: true }), // Inside crop, already visible
      createOcr({ id: 'ocr-inside-not-visible', isVisible: false }), // Inside crop, not visible
      createOcr({
        id: 'ocr-outside-visible',
        x1: 0.8,
        y1: 0.8,
        x2: 0.9,
        y2: 0.8,
        x3: 0.9,
        y3: 0.9,
        x4: 0.8,
        y4: 0.9,
        isVisible: true,
      }), // Outside crop, already visible
      createOcr({
        id: 'ocr-outside-not-visible',
        x1: 0.8,
        y1: 0.8,
        x2: 0.9,
        y2: 0.8,
        x3: 0.9,
        y3: 0.9,
        x4: 0.8,
        y4: 0.9,
        isVisible: false,
      }), // Outside crop, not visible
    ];
    const crop = { x1: 0, y1: 0, x2: 500, y2: 500 };

    const result = checkOcrVisibility(ocrs, assetDimensions, crop);

    // When crop is provided, only overlap matters, not isVisible property
    expect(result.visible).toHaveLength(2);
    expect(result.hidden).toHaveLength(2);
    expect(result.visible.map((o) => o.id)).toContain('ocr-inside-visible');
    expect(result.visible.map((o) => o.id)).toContain('ocr-inside-not-visible');
    expect(result.hidden.map((o) => o.id)).toContain('ocr-outside-visible');
    expect(result.hidden.map((o) => o.id)).toContain('ocr-outside-not-visible');
  });

  it('should handle mixed visibility states with partial overlap and crop', () => {
    const ocrs = [
      createOcr({ id: 'ocr-partial-50', isVisible: true }), // 50% overlap
      createOcr({ id: 'ocr-partial-40', isVisible: false }), // 40% overlap
    ];
    const crop1 = { x1: 150, y1: 100, x2: 500, y2: 500 }; // 50% overlap
    const crop2 = { x1: 160, y1: 100, x2: 500, y2: 500 }; // 40% overlap

    const result1 = checkOcrVisibility([ocrs[0]], assetDimensions, crop1);
    const result2 = checkOcrVisibility([ocrs[1]], assetDimensions, crop2);

    // 50% overlap should be visible
    expect(result1.visible).toHaveLength(1);
    expect(result1.hidden).toHaveLength(0);

    // 40% overlap should be hidden
    expect(result2.visible).toHaveLength(0);
    expect(result2.hidden).toHaveLength(1);
  });
});
