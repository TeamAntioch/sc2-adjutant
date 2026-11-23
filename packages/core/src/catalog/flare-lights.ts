// Candidate "flare" lights for a Mission's flare moment, plus a custom one.
// Presets were picked from LightData.xml (via SC2GameData) by their numbers alone;
// the lighting preview map exists to check them by eye.

export type FlareLightCandidate = {
  readonly id: string;
  /** Shown on screen while the light is active. */
  readonly label: string;
};

export const BASELINE_LIGHT = "BelShirEx2";

/** Chosen in the lighting preview (2026-10-25): reads as an overexposed orange glare. */
export const FLARE_LIGHT = "ArcadeSkyboxSpaceLightSpecial";

export const FLARE_LIGHT_CANDIDATES: readonly FlareLightCandidate[] = [
  { id: "DominionLab02OutsideTramFlash", label: "Tram Flash: white-hot sun, yellow glare" },
  { id: "SMX3_Cutscene_MP03_035_Space_Low", label: "Space Low: airless white sun, hard shadows" },
  { id: "ArcadeSkyboxSpaceLightSpecial", label: "Arcade Space: overexposed orange glare" },
  { id: "BelShirFlare", label: "BelShirFlare (custom): BelShir sun x3.5, hot ambient" },
];

/**
 * BelShirEx2's light (mods/void.sc2mod LightData.xml) copied in full, with the sun,
 * ambient, exposure and bloom pushed up. A full copy avoids relying on inheritance
 * from a non-default light; the sun direction is unchanged so shadows don't swing.
 */
export function belShirFlareLightXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Catalog>
    <CLight id="BelShirFlare">
        <ToDInfoArray index="0">
            <Id value="NoLight"/>
            <AmbientColor value="0.752941,0.705882,0.450980"/>
            <OperatorHDR value="4"/>
            <Colorize value="1"/>
            <Param index="HDRExposure" value="1.900000"/>
            <Param index="HDRWhitePoint" value="1.850000"/>
            <Param index="HDRBloomThreshold" value="0.350000"/>
            <Param index="HDRGain" value="0.000000"/>
            <Param index="HDRScale" value="0.000000"/>
            <Param index="TerrainSpecularExp" value="11.210000"/>
            <Param index="TerrainHDRSpecular" value="3.750000"/>
            <Param index="CreepSpecularExp" value="30.000000"/>
            <Param index="CreepHDRSpecMultiplier" value="3.000000"/>
            <Param index="ColorizationContrast" value="1.066000"/>
            <Param index="ColorizationHue" value="0.001000"/>
            <Param index="ColorizationBlend" value="0.300000"/>
            <Param index="AOOcclusionRadius" value="1.000000"/>
            <Param index="AONoOcclusion" value="0.900000"/>
            <Param index="AOOcclusionPower" value="2.000000"/>
            <Param index="AODetailOcclusionRadius" value="0.010000"/>
            <Param index="AODetailNoOcclusion" value="0.060000"/>
            <Param index="AODetailOcclusionPower" value="4.000000"/>
            <DirectionalLight index="Key">
                <Color value="1.000000,0.980392,0.890196"/>
                <ColorMultiplier value="3.500000"/>
                <SpecColorMultiplier value="1.250000"/>
                <Direction value="0.724693,-0.124265,-0.677775"/>
            </DirectionalLight>
            <DirectionalLight index="Fill" Color="0.211765,0.529412,0.529412" ColorMultiplier="1.500000" Direction="-0.463854,-0.769851,0.438371"/>
            <DirectionalLight index="Back" Color="0.082353,0.121569,0.200000" ColorMultiplier="1.400000" Direction="-0.668793,-0.021251,0.743145"/>
        </ToDInfoArray>
        <EditorCategories value="LightGroup:Tilesets"/>
    </CLight>
</Catalog>
`.replace(/\n/g, "\r\n");
}
