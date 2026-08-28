import type { PointM } from "./types";

export interface SpatialPointItem {
  pointM: PointM;
}

/** Tiny uniform-grid index suited to metric plans and repeatedly queried pointer neighborhoods. */
export class SpatialPointIndex<T extends SpatialPointItem> {
  private readonly buckets = new Map<string, T[]>();
  readonly cellSizeM: number;
  constructor(items: readonly T[], cellSizeM = 10) {
    this.cellSizeM = cellSizeM;
    for (const item of items) {
      const key = this.key(item.pointM.xM, item.pointM.yM);
      const bucket = this.buckets.get(key);
      if (bucket) bucket.push(item);
      else this.buckets.set(key, [item]);
    }
  }
  private key(xM: number, yM: number) {
    return `${Math.floor(xM / this.cellSizeM)}:${Math.floor(yM / this.cellSizeM)}`;
  }
  query(point: PointM, radiusM: number): T[] {
    const minX = Math.floor((point.xM - radiusM) / this.cellSizeM);
    const maxX = Math.floor((point.xM + radiusM) / this.cellSizeM);
    const minY = Math.floor((point.yM - radiusM) / this.cellSizeM);
    const maxY = Math.floor((point.yM + radiusM) / this.cellSizeM);
    const result: T[] = [];
    for (let x = minX; x <= maxX; x += 1)
      for (let y = minY; y <= maxY; y += 1) result.push(...(this.buckets.get(`${x}:${y}`) ?? []));
    return result;
  }
}
