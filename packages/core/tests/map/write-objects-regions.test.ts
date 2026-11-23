import { describe, expect, it } from "vitest";

import { writeObjectsXml, type WriteObjectsOptions } from "../../src/map/write-objects-xml.js";
import { boundsShape, writeRegionsXml, type WriteRegionsOptions } from "../../src/map/write-regions-xml.js";

describe("writeObjectsXml", () => {
  it("emits ObjectUnit, ObjectPoint, and ObjectCamera entries with stable ids", () => {
    const options: WriteObjectsOptions = {
      anchors: [
        {
          id: 1096361704,
          name: "Zeratul",
          zoneId: "landing_zone",
          kind: "unit",
          position: { x: 20, y: 20, z: 8 },
          rotation: 0,
          unitType: "Zeratul",
          player: 1,
        },
        {
          id: 188318128,
          name: "Checkpoint 1",
          zoneId: "landing_zone",
          kind: "point",
          position: { x: 25, y: 25, z: 0 },
          rotation: 1.57,
          pointType: "Normal",
        },
        {
          id: 1610565589,
          name: "Opening Camera",
          zoneId: "landing_zone",
          kind: "camera",
          position: { x: 20, y: 20, z: 12 },
          rotation: 0,
          cameraTarget: { x: 20, y: 20 },
          cameraValues: [
            { index: "FieldOfView", value: 27.8 },
            { index: "Distance", value: 34 },
          ],
        },
      ],
    };
    const xml = writeObjectsXml(options);
    expect(xml).toContain("<PlacedObjects Version=\"27\">");
    expect(xml).toContain('Id="1096361704"');
    expect(xml).toContain('UnitType="Zeratul"');
    expect(xml).toContain('Id="188318128"');
    expect(xml).toContain('Type="Normal"');
    expect(xml).toContain('Id="1610565589"');
    expect(xml).toContain('CameraTarget="20,20"');
    expect(xml).toContain("</PlacedObjects>");
  });

  it("writes every camera value, the game camera's defaults under the anchor's own", () => {
    const xml = writeObjectsXml({
      anchors: [
        {
          id: 1,
          name: "Low",
          zoneId: "street",
          kind: "camera",
          position: { x: 48, y: 50, z: 9 },
          cameraTarget: { x: 48, y: 50 },
          cameraValues: [
            { index: "Distance", value: 30 },
            { index: "Pitch", value: 18 },
          ],
        },
      ],
    });
    const values = [...xml.matchAll(/<CameraValue Index="(\w+)" Value="([\d.]+)"\/>/g)].map(([, index, value]) => [index, Number(value)]);
    // An unwritten value reads as about zero in the Editor: a FarClip of 0 shows nothing but the skybox.
    expect(values).toContainEqual(["NearClip", 0.0998]);
    expect(values).toContainEqual(["FarClip", 600]);
    expect(values).toContainEqual(["ShadowClip", 75]);
    expect(values).toContainEqual(["Yaw", 180]);
    expect(values).toContainEqual(["Distance", 30]);
    expect(values).toContainEqual(["Pitch", 18]);
    expect(values.filter(([index]) => index === "Distance")).toHaveLength(1);
  });

  it("turns a camera to its yaw, which the Editor culls the view by", () => {
    const camera = (yaw?: number) =>
      writeObjectsXml({
        anchors: [
          {
            id: 1,
            name: "Cam",
            zoneId: "street",
            kind: "camera",
            position: { x: 48, y: 40, z: 9 },
            rotation: 0,
            cameraValues: yaw === undefined ? [] : [{ index: "Yaw", value: yaw }],
          },
        ],
      });
    expect(camera()).toContain('Rotation="3.1416"');
    expect(camera(90)).toContain('Rotation="1.5708"');
  });
});

describe("writeRegionsXml", () => {
  it("emits region entries with rect shapes from zone bounds", () => {
    const options: WriteRegionsOptions = {
      regions: [
        {
          name: "Landing Zone",
          shapes: [
            boundsShape([
              { x: 10, y: 10 },
              { x: 30, y: 10 },
              { x: 30, y: 30 },
              { x: 10, y: 30 },
            ]),
          ],
        },
      ],
    };
    const xml = writeRegionsXml(options);
    expect(xml).toContain("<Regions>");
    expect(xml).toContain('<region id="1">');
    expect(xml).toContain('<name value="Landing Zone"/>');
    expect(xml).toContain('<shape type="rect">');
    expect(xml).toContain('<quad value="10,10,30,30"/>');
    expect(xml).toContain("</Regions>");
  });
});
