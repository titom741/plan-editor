/** Konva-compatible filter that makes near-white pixels transparent. */
export function createWhiteRemovalFilter(threshold: number) {
  const safeThreshold = Math.max(0, Math.min(255, threshold));
  return (imageData: ImageData) => {
    const { data } = imageData;
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;
      if (red >= safeThreshold && green >= safeThreshold && blue >= safeThreshold) data[index + 3] = 0;
    }
  };
}
