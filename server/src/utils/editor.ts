type BoundingBox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export const boundingBoxOverlap = (boxA: BoundingBox, boxB: BoundingBox) => {
  const overlapX1 = Math.max(boxA.x1, boxB.x1);
  const overlapY1 = Math.max(boxA.y1, boxB.y1);
  const overlapX2 = Math.min(boxA.x2, boxB.x2);
  const overlapY2 = Math.min(boxA.y2, boxB.y2);

  const overlapArea = Math.max(0, overlapX2 - overlapX1) * Math.max(0, overlapY2 - overlapY1);
  const faceArea = (boxA.x2 - boxA.x1) * (boxA.y2 - boxA.y1);
  return overlapArea / faceArea;
};
