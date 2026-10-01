import { describe, expect, it } from "vitest";

import { fitWithin, MAX_IMAGE_DIMENSION } from "@/lib/media/resize";
import { COVER_ASPECT } from "@/lib/media/rules";

describe("fitWithin", () => {
  it("reduz mantendo a proporção pelo lado maior", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1920, height: 1440 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1440, height: 1920 });
  });

  it("não aumenta imagem pequena", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("nunca devolve dimensão zero", () => {
    expect(fitWithin(10000, 1)).toEqual({ width: MAX_IMAGE_DIMENSION, height: 1 });
  });

  it("recorte 16:9 de foto grande sai em 1920 × 1080", () => {
    const width = 3200;
    expect(fitWithin(width, width / COVER_ASPECT)).toEqual({ width: 1920, height: 1080 });
  });
});
