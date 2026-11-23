import type { RegionLook, RegionShape } from "../domain/mission-blueprint.js";
import { xmlElement, xmlElements } from "./xml-elements.js";

export type EditorRegion = { readonly id: number; readonly name: string } & RegionLook;

const numbers = (value: string | undefined): number[] => (value ?? "").split(",").map(Number);

function shapeOf(type: string | undefined, body: string): RegionShape | undefined {
  const value = (tag: string) => xmlElement(body, tag)?.attrs.value;
  const negative = /<negative\s*\/>/.test(body) ? { negative: true } : {};
  if (type === "rect") {
    const [x0, y0, x1, y1] = numbers(value("quad"));
    return { type, quad: [x0!, y0!, x1!, y1!], ...negative };
  }
  const [x, y] = numbers(value("center"));
  if (type === "circle") return { type, center: { x: x!, y: y! }, radius: Number(value("radius")), ...negative };
  if (type === "diamond") return { type, center: { x: x!, y: y! }, width: Number(value("width")), height: Number(value("height")), ...negative };
  return undefined;
}

/** Reads the Regions file: each region's id, name, colour, visibility and shapes. */
export function readRegionsXml(xml: string): EditorRegion[] {
  return xmlElements(xml, "region").map(({ attrs, body }) => {
    const color = xmlElement(body, "color")?.attrs.value;
    return {
      id: Number(attrs.id),
      name: xmlElement(body, "name")?.attrs.value ?? "",
      ...(color ? { color } : {}),
      ...(/<invisible\s*\/>/.test(body) ? { invisible: true } : {}),
      shapes: xmlElements(body, "shape").flatMap(({ attrs: shape, body: inner }) => shapeOf(shape.type, inner) ?? []),
    };
  });
}

/** The bounds of a region's shapes that add area, as [x0, y0, x1, y1]. */
export function regionBounds(shapes: readonly RegionShape[]): [number, number, number, number] {
  const boxes = shapes
    .filter((shape) => !shape.negative)
    .map((shape): [number, number, number, number] => {
      if (shape.type === "rect") return [Math.min(shape.quad[0], shape.quad[2]), Math.min(shape.quad[1], shape.quad[3]), Math.max(shape.quad[0], shape.quad[2]), Math.max(shape.quad[1], shape.quad[3])];
      if (shape.type === "circle") return [shape.center.x - shape.radius, shape.center.y - shape.radius, shape.center.x + shape.radius, shape.center.y + shape.radius];
      return [shape.center.x - shape.width / 2, shape.center.y - shape.height / 2, shape.center.x + shape.width / 2, shape.center.y + shape.height / 2];
    });
  if (boxes.length === 0) throw new Error("the region has no shape that adds area");
  return [Math.min(...boxes.map((box) => box[0])), Math.min(...boxes.map((box) => box[1])), Math.max(...boxes.map((box) => box[2])), Math.max(...boxes.map((box) => box[3]))];
}
