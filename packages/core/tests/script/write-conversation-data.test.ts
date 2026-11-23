import { describe, expect, it } from "vitest";

import { stableObjectId } from "../../src/map/stable-object-id.js";
import { scriptLines } from "../../src/script/name-script.js";
import { conversationDataXml, conversationStrings, soundDataXml } from "../../src/script/write-conversation-data.js";
import { buildMissionTriggers } from "../../src/triggers/build-mission-triggers.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";
import { CrossingBlueprintSchema, crossingRaw, crossingScript as script } from "../support/workspaces.js";

const blueprint = CrossingBlueprintSchema.parse(crossingRaw);

describe("dialogue data", () => {
  it("puts every line in one CConversation, grouped by scene", () => {
    const xml = conversationDataXml(script);
    expect(xml).toContain('<CConversation id="ashen_crossing">');
    expect(xml.match(/<Lines>/g)).toHaveLength(scriptLines(script).length);
    expect(xml).toContain('<SpeakerCharacter value="Karax"/>');
    expect(xml).toContain('<Groups Id="Group00003" Name="Conversation/ashen_crossing/Group00003">');
    expect(xml).toContain('<RootItems value="Group00001"/>');
  });

  it("gives each line a dialogue CSound pointing at its voice file", () => {
    const xml = soundDataXml(script, "wav");
    expect(xml).toContain('<CSound id="ashen_crossing-1-1" parent="Campaign2D" Subtitle="ashen_crossing" Speaker="Karax" Actor="" Line="1-1">');
    expect(xml).toContain('<File value="Assets\\Sounds\\Conversations\\ashen_crossing-1-1.wav"/>');
    expect(xml).toContain('<Subtitle value="Conversation/ashen_crossing/Line1-1"/>');
  });

  it("writes line texts and scene titles as conversation strings", () => {
    const strings = conversationStrings(script);
    expect(strings["Conversation/ashen_crossing/Line3-2"]).toBe("En taro Tassadar. Bring it home.");
    expect(strings["Conversation/ashen_crossing/Group00002"]).toBe("BETWEEN THE SURGES");
  });

  it("labels a line's subtitle with its speaker's Transmission name, through its CSound", () => {
    // A CCharacter id unlike the shown name, as a Campaign Pack's naming template gives: a
    // dependency may already give the key another name, such as the speaker's first name.
    const line = scriptLines(script)[0]!;
    const renamed = {
      ...script,
      scenes: [
        {
          number: 1,
          title: "ONE",
          items: [
            { ...line, character: "Vane", characterId: "CharVane" },
            { ...line, lineId: "Line1-9", soundId: "vane-2", character: "Vane", characterId: "CharVane" },
          ],
        },
      ],
    };
    expect(soundDataXml(renamed, "wav").match(/<Speaker value="ConversationState\/Characters\/CharVane"\/>/g)).toHaveLength(2);
    const strings = conversationStrings(renamed);
    expect(strings["ConversationState/Characters/CharVane"]).toBe("Vane");
    expect(strings[`Conversation/ashen_crossing/${line.lineId}`]).toBe(line.text);
    expect(strings["Conversation/ashen_crossing/Line1-9"]).toBe(line.text);
    expect(conversationStrings(script)["ConversationState/Characters/Karax"]).toBe("Karax");
  });
});

describe("script scenes as standard transmissions", () => {
  const doc = buildMissionTriggers(blueprint, { script });
  const galaxy = writeMapScript({ mapName: blueprint.title, triggers: doc });

  it("plays each cued scene's lines, lasting as long as the audio and waiting for it", () => {
    // Scenes 1 and 3 have cues; scene 2 has none, so it isn't played.
    expect(galaxy.match(/TransmissionSendForPlayerSelect\(/g)).toHaveLength(4 + 2);
    expect(galaxy).toMatch(
      new RegExp(
        String.raw`TransmissionSendForPlayerSelect\(PlayerGroupAll\(\), TransmissionSource\(\), ` +
          String.raw`libNtve_gf_CinematicPortrait\(libNtve_ge_CinematicPortraitPosition_CenterRight\), "", "Talk", ` +
          String.raw`SoundLink\("ashen_crossing-1-1", -1\), StringExternal\("Param/Value/[0-9A-F]{8}"\), StringExternal\("Param/Value/[0-9A-F]{8}"\), ` +
          String.raw`0\.0, c_transmissionDurationAdd, true, c_maxPlayers, false\);`,
      ),
    );
  });

  it("uses the speaking unit on the map, and no source for a speaker with no character", () => {
    expect(galaxy).toContain(`TransmissionSourceFromUnit(UnitFromId(${stableObjectId("hero_zeratul")}), true, false, "Talk")`);
    expect(galaxy).toContain("TransmissionSendForPlayerSelect(PlayerGroupAll(), TransmissionSource(), ");
  });

  it("needs the parsed script when the blueprint references one", () => {
    expect(() => buildMissionTriggers(blueprint)).toThrow(/parsed script/);
  });
});
