"""Renders one cinematic set in neutral light, for `npm run render-set-views`.

    blender --background --factory-startup --python render-set.py -- <spec.json>

The spec names each piece's .glb (a game model with its textures embedded) with its place, turn and
scale in the set's frame, the catalogue's cameras, and the folder to write to. Writes plan.jpg (from
directly above, with everything over `cutZ` cut away so a roof doesn't hide the room), overview.jpg
(a three-quarter view from outside), one cam-<n>.jpg per catalogue camera, and views.json (the
set's extents and what was drawn).

Eevee, with every surface lit evenly from its own textures (evenly_lit): its diffuse and specular
map added, plus its emissive, shaded a little by its normal map for form. A composite material, which the glTF carries empty, is rebuilt from the sections the
spec lists for it (`composites`), and a material's specular map (`speculars`), which the glTF has no place for, is added;
both come from the model file. Alpha layers, particles and material animation of the game aren't drawn.
"""
import json
import math
import os
import struct
import sys

import bmesh
import bpy
from mathutils import Vector

spec = json.load(open(sys.argv[sys.argv.index("--") + 1]))
out = spec["out"]
os.makedirs(out, exist_ok=True)
# How much of a surface's diffuse and of its specular map shows, and the darkest a face turned from the light gets.
LIGHT = {"diffuse": 3.0, "specular": 1.0, "shade": 0.55, "glow": 0.5, **spec.get("light", {})}

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)

# What the views are drawn like: set-views draws a set again when this differs from its views.json (VIEWS_VERSION there).
VERSION = 2
MARKER = "__material_"


def with_markers(glb, wanted):
    """A copy of the .glb with one small extra object per wanted material, named for its index.

    Blender's importer makes a material only when a mesh uses it, and names it as it likes, so a
    composite's sections (which no mesh uses) would never arrive, and no material could be told by
    its index. Each marker borrows the model's smallest primitive; the import reads the material off
    it and removes it.
    """
    data = open(glb, "rb").read()
    length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20 : 20 + length])
    rest = data[20 + length :]
    primitives = [p for mesh in gltf.get("meshes", []) for p in mesh["primitives"] if "indices" in p]
    if not primitives:
        return None
    donor = min(primitives, key=lambda p: gltf["accessors"][p["indices"]]["count"])
    for index in wanted:
        if index >= len(gltf.get("materials", [])):
            continue
        gltf["meshes"].append({"name": f"{MARKER}{index}", "primitives": [{**donor, "material": index}]})
        gltf["nodes"].append({"name": f"{MARKER}{index}", "mesh": len(gltf["meshes"]) - 1})
        gltf["scenes"][gltf.get("scene", 0)]["nodes"].append(len(gltf["nodes"]) - 1)
    text = json.dumps(gltf).encode()
    text += b" " * (-len(text) % 4)
    marked = os.path.join(out, "marked.glb")
    with open(marked, "wb") as file:
        file.write(data[:8] + struct.pack("<I", 20 + len(text) + len(rest)) + struct.pack("<I", len(text)) + data[16:20] + text + rest)
    return marked


def upstream_image(socket):
    """The first image texture feeding a socket."""
    seen, queue = set(), [link.from_node for link in socket.links]
    while queue:
        node = queue.pop(0)
        if node in seen:
            continue
        seen.add(node)
        if node.type == "TEX_IMAGE" and node.image:
            return node
        queue += [link.from_node for input in node.inputs for link in input.links]
    return None


def copy_image(tree, source):
    """An image texture as `source` is, in another tree, with the UV map and mapping that feed it."""
    image = tree.nodes.new("ShaderNodeTexImage")
    image.image, image.extension, image.interpolation = source.image, source.extension, source.interpolation
    target, feed = image.inputs["Vector"], source.inputs["Vector"]
    while feed.is_linked:
        node = feed.links[0].from_node
        if node.type == "MAPPING":
            copy = tree.nodes.new("ShaderNodeMapping")
            copy.vector_type = node.vector_type
            for name in ("Location", "Rotation", "Scale"):
                copy.inputs[name].default_value = node.inputs[name].default_value
            tree.links.new(copy.outputs[0], target)
            target, feed = copy.inputs[0], node.inputs[0]
        elif node.type == "UVMAP":
            copy = tree.nodes.new("ShaderNodeUVMap")
            copy.uv_map = node.uv_map
            tree.links.new(copy.outputs[0], target)
            break
        else:
            break
    return image


def layered(sections):
    """A composite material: its first section, with each later section's colour mixed over it.

    The game draws a composite's sections in order, each over the last by its own alpha and the
    section's weight. `sections` is (material, weight) pairs.
    """
    material = sections[0][0].copy()
    tree = material.node_tree
    shader = tree and tree.nodes.get("Principled BSDF")
    if not shader:
        return material
    for layer, weight in sections[1:]:
        layer_shader = layer.node_tree and layer.node_tree.nodes.get("Principled BSDF")
        source = layer_shader and upstream_image(layer_shader.inputs["Base Color"])
        if not source:
            continue
        image = copy_image(tree, source)
        mix = tree.nodes.new("ShaderNodeMix")
        mix.data_type, mix.blend_type = "RGBA", "MIX"
        under = shader.inputs["Base Color"]
        if under.is_linked:
            tree.links.new(under.links[0].from_socket, mix.inputs[6])
        else:
            mix.inputs[6].default_value = under.default_value
        tree.links.new(image.outputs["Color"], mix.inputs[7])
        if layer_shader.inputs["Alpha"].is_linked:
            if weight == 1:
                tree.links.new(image.outputs["Alpha"], mix.inputs[0])
            else:
                scale = tree.nodes.new("ShaderNodeMath")
                scale.operation = "MULTIPLY"
                scale.inputs[1].default_value = weight
                tree.links.new(image.outputs["Alpha"], scale.inputs[0])
                tree.links.new(scale.outputs[0], mix.inputs[0])
        else:
            mix.inputs[0].default_value = max(0.0, min(1.0, weight))
        tree.links.new(mix.outputs[2], under)
    return material


def evenly_lit(material):
    """Shades a material by its own textures alone, so it reads the same wherever it stands.

    A set is a closed room: light from outside doesn't reach in, and the game's own lights are what
    made it bright. The game's metals are a dark diffuse under a bright specular map, lit well past
    1, and the glTF carries only the diffuse. So each surface shows its diffuse and its specular map
    (the material's "specular" property, from the model file) added together, plus its emissive,
    darkened a little where it faces away from a fixed light, by its normal map, for form.
    """
    tree = material.node_tree
    shader = tree and tree.nodes.get("Principled BSDF")
    output = tree and next((node for node in tree.nodes if node.type == "OUTPUT_MATERIAL"), None)
    if not shader or not output:
        return
    nodes, links = tree.nodes, tree.links

    def scaled(source, factor):
        mix = nodes.new("ShaderNodeMix")
        mix.data_type, mix.blend_type = "RGBA", "MULTIPLY"
        mix.inputs[0].default_value = 1
        if isinstance(source, bpy.types.NodeSocket):
            links.new(source, mix.inputs[6])
        else:
            mix.inputs[6].default_value = source
        mix.inputs[7].default_value = (factor, factor, factor, 1)
        return mix.outputs[2]

    def added(a, b):
        mix = nodes.new("ShaderNodeMix")
        mix.data_type, mix.blend_type = "RGBA", "ADD"
        mix.inputs[0].default_value = 1
        links.new(a, mix.inputs[6])
        links.new(b, mix.inputs[7])
        return mix.outputs[2]

    base = shader.inputs["Base Color"]
    blend = material.get("blend")
    if blend:
        # A material the game adds to what is behind it (a glow, a light shaft) is light over a clear
        # sheet, from its diffuse and emissive pictures: black adds nothing, and one with no picture
        # shows nothing. One that isn't a surface (a shadow sheet, a fog volume) isn't drawn.
        clear = nodes.new("ShaderNodeBsdfTransparent")
        result = clear.outputs[0]
        pictures = [socket.links[0].from_socket for socket in (base, shader.inputs["Emission Color"]) if socket.is_linked]
        if blend == "add" and pictures:
            light = nodes.new("ShaderNodeEmission")
            links.new(pictures[0] if len(pictures) == 1 else added(*pictures), light.inputs["Color"])
            light.inputs["Strength"].default_value = LIGHT["glow"]
            both = nodes.new("ShaderNodeAddShader")
            links.new(clear.outputs[0], both.inputs[0])
            links.new(light.outputs[0], both.inputs[1])
            result = both.outputs[0]
        links.new(result, output.inputs["Surface"])
        material.surface_render_method = "BLENDED"
        return
    colour = scaled(base.links[0].from_socket if base.is_linked else tuple(base.default_value), LIGHT["diffuse"])
    texture = material.get("specular")
    if texture and os.path.exists(texture):
        image = nodes.new("ShaderNodeTexImage")
        image.image = bpy.data.images.load(texture, check_existing=True)
        diffuse = upstream_image(base)
        if diffuse and diffuse.inputs["Vector"].is_linked:
            links.new(diffuse.inputs["Vector"].links[0].from_socket, image.inputs["Vector"])
        colour = added(colour, scaled(image.outputs["Color"], LIGHT["specular"]))
    # Form: the normal against a fixed light from above and one side.
    if shader.inputs["Normal"].is_linked:
        normal = shader.inputs["Normal"].links[0].from_socket
    else:
        normal = nodes.new("ShaderNodeNewGeometry").outputs["Normal"]
    facing = nodes.new("ShaderNodeVectorMath")
    facing.operation = "DOT_PRODUCT"
    links.new(normal, facing.inputs[0])
    facing.inputs[1].default_value = Vector((0.35, -0.45, 0.82)).normalized()
    shade = nodes.new("ShaderNodeMapRange")
    shade.inputs["From Min"].default_value, shade.inputs["From Max"].default_value = -1, 1
    shade.inputs["To Min"].default_value, shade.inputs["To Max"].default_value = LIGHT["shade"], 1
    links.new(facing.outputs["Value"], shade.inputs["Value"])
    shaded = nodes.new("ShaderNodeMix")
    shaded.data_type, shaded.blend_type = "RGBA", "MULTIPLY"
    shaded.inputs[0].default_value = 1
    links.new(colour, shaded.inputs[6])
    links.new(shade.outputs["Result"], shaded.inputs[7])
    colour = shaded.outputs[2]
    glow = shader.inputs["Emission Color"]
    if glow.is_linked:
        colour = added(colour, glow.links[0].from_socket)
    surface = nodes.new("ShaderNodeEmission")
    links.new(colour, surface.inputs["Color"])
    result = surface.outputs[0]
    if shader.inputs["Alpha"].is_linked:
        clear = nodes.new("ShaderNodeBsdfTransparent")
        blend = nodes.new("ShaderNodeMixShader")
        links.new(shader.inputs["Alpha"].links[0].from_socket, blend.inputs[0])
        links.new(clear.outputs[0], blend.inputs[1])
        links.new(result, blend.inputs[2])
        result = blend.outputs[0]
    links.new(result, output.inputs["Surface"])


drawn, missing = 0, []
for piece in spec["pieces"]:
    if not os.path.exists(piece["glb"]):
        missing.append(piece["model"])
        continue
    composites, speculars = piece.get("composites", []), piece.get("speculars", [])
    wanted = sorted({index for composite in composites for index in [composite["material"], *[s["material"] for s in composite["sections"]]]} | {s["material"] for s in speculars} | {b["material"] for b in piece.get("blends", [])})
    before = set(bpy.data.objects)
    marked = wanted and with_markers(piece["glb"], wanted)
    bpy.ops.import_scene.gltf(filepath=marked or piece["glb"])
    if marked:
        os.remove(marked)
    added = [o for o in bpy.data.objects if o not in before]
    materials = {}
    for obj in [o for o in added if o.name.startswith(MARKER)]:
        materials[int(obj.name[len(MARKER) :].split(".")[0])] = obj.data.materials[0] if obj.data.materials else None
        added.remove(obj)
        bpy.data.objects.remove(obj, do_unlink=True)
    for specular in speculars:
        if materials.get(specular["material"]):
            materials[specular["material"]]["specular"] = specular["texture"]
    for blend in piece.get("blends", []):
        if materials.get(blend["material"]):
            materials[blend["material"]]["blend"] = blend["blend"]
    for composite in composites:
        sections = [(materials.get(s["material"]), s["weight"]) for s in composite["sections"]]
        whole = materials.get(composite["material"])
        if not whole or not sections or any(material is None for material, _ in sections):
            continue
        built = layered(sections)
        for obj in added:
            for slot in obj.material_slots:
                if slot.material == whole:
                    slot.material = built
    for obj in [o for o in added if o.parent is None]:
        obj.rotation_mode = "XYZ"
        obj.rotation_euler = [math.radians(d) for d in piece.get("rotation", (0, 0, 0))]
        obj.scale = piece.get("scale", (1, 1, 1))
        obj.location = piece["at"]
    drawn += 1


# The glTF importer culls back faces, which a hull seen from outside needs drawn. A material with
# no texture and a white colour would show as blank white: a mid grey instead.
for material in bpy.data.materials:
    material.use_backface_culling = False
    node = material.node_tree and material.node_tree.nodes.get("Principled BSDF")
    if node and not node.inputs["Base Color"].is_linked and min(node.inputs["Base Color"].default_value[:3]) > 0.6:
        node.inputs["Base Color"].default_value = (0.3, 0.3, 0.3, 1)
    evenly_lit(material)


meshes = [o for o in bpy.data.objects if o.type == "MESH"]
bpy.context.view_layer.update()
low, high = Vector((1e9,) * 3), Vector((-1e9,) * 3)
for obj in meshes:
    for corner in obj.bound_box:
        point = obj.matrix_world @ Vector(corner)
        low = Vector(map(min, low, point))
        high = Vector(map(max, high, point))
if not meshes:
    raise SystemExit("nothing to draw")
centre, size = (low + high) / 2, high - low

scene = bpy.context.scene
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT" if bpy.app.version < (5, 0, 0) else "BLENDER_EEVEE"
scene.eevee.taa_render_samples = 32
scene.render.resolution_x, scene.render.resolution_y = 1280, 720
scene.render.image_settings.file_format = "JPEG"
scene.render.image_settings.quality = 85
scene.view_settings.view_transform = "Standard"
# Every surface gives its own light (evenly_lit), so the world is only the backdrop.
scene.world = bpy.data.worlds.new("neutral")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.6, 0.6, 0.6, 1)

camera = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
scene.collection.objects.link(camera)
scene.camera = camera


def shoot(name, eye, target, fov=None, ortho=None, clip_start=0.05):
    camera.data.type = "ORTHO" if ortho else "PERSP"
    if ortho:
        camera.data.ortho_scale = ortho
    else:
        camera.data.sensor_fit = "VERTICAL"
        camera.data.angle_y = math.radians(fov)
    camera.data.clip_start, camera.data.clip_end = clip_start, 2000
    camera.location = Vector(eye)
    camera.rotation_euler = (Vector(target) - Vector(eye)).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(out, name + ".jpg")
    bpy.ops.render.render(write_still=True)


def cut_roof(cut):
    """Cuts every mesh at this height, so a view from above looks into the room."""
    for obj in meshes:
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        world = obj.matrix_world
        mesh = bmesh.new()
        mesh.from_mesh(obj.data)
        bmesh.ops.bisect_plane(
            mesh,
            geom=mesh.verts[:] + mesh.edges[:] + mesh.faces[:],
            plane_co=world.inverted() @ Vector((0, 0, cut)),
            plane_no=world.to_3x3().transposed() @ Vector((0, 0, 1)),
            clear_outer=True,
        )
        mesh.to_mesh(obj.data)
        mesh.free()


def plan(name, cut):
    across = max(size.x / 16, size.y / 9) * 9 * 1.06
    shoot(name, (centre.x, centre.y, cut + 10), (centre.x, centre.y, low.z), ortho=max(across, 1), clip_start=0.5)


def orbit(name, azimuth, pitch, fov=35):
    """From outside, at this compass bearing from the centre (0 north, 90 east), looking down at this pitch, far enough back to hold the whole set."""
    distance = math.hypot(size.x, size.y) / 2 / math.tan(math.radians(fov) / 2) * 0.85
    bearing = math.radians(90 - azimuth)
    eye = centre + Vector((math.cos(bearing), math.sin(bearing), 0)) * distance * math.cos(math.radians(pitch))
    eye.z = centre.z + distance * math.sin(math.radians(pitch))
    shoot(name, eye, centre, fov=fov)


def floor_levels():
    """
    The height the set's floor lies at, to a quarter cell, where its lowest point may be far below,
    and the five levels holding the most such surface (each with its share), since the guess can be wrong:
    the level holding the most upward-facing surface with a cell of clear air over it. Surface with
    something overhead counts alone when there is enough of it, so a roof's top isn't taken for the
    floor, and of levels nearly as large the lowest wins.
    """
    graph = bpy.context.evaluated_depsgraph_get()
    up = Vector((0, 0, 1))
    roofed, all_levels = {}, {}
    for obj in meshes:
        world = obj.matrix_world
        turn = world.to_3x3().inverted().transposed()
        grown = abs(world.to_3x3().determinant()) ** (2 / 3)
        for face in obj.data.polygons:
            # Small faces are props and trim, and a set of hundreds of pieces has too many to test each.
            if face.area * grown < 0.05 or (turn @ face.normal).normalized().z < 0.9:
                continue
            at = world @ face.center
            # A skinned mesh's rest shape can lie outside the bounds it is drawn in.
            if not low.z - 0.1 <= at.z <= high.z + 0.1:
                continue
            hit, where, *_ = scene.ray_cast(graph, at + up * 0.05, up)
            if hit and where.z - at.z < 1:
                continue
            level, area = round(at.z * 4) / 4, face.area * grown
            all_levels[level] = all_levels.get(level, 0) + area
            if hit:
                roofed[level] = roofed.get(level, 0) + area
    levels = roofed if sum(roofed.values()) >= 0.25 * sum(all_levels.values()) else all_levels
    if not levels:
        return low.z, []
    most, whole = max(levels.values()), sum(levels.values())
    largest = sorted(levels.items(), key=lambda entry: -entry[1])[:5]
    return min(level for level, area in levels.items() if area >= 0.6 * most), [{"z": level, "share": round(area / whole, 2)} for level, area in largest]


def ceiling_levels(floor):
    """
    The height of the ceiling over this floor, to a quarter cell, or None where there is none, and
    the five levels holding the most downward-facing surface a cell or more over the floor (each
    with its share): the lowest of those levels holding at least 0.3 of the floor's own area. A
    room's ceiling is often well under its model's top, so a cut at the top leaves it on; the
    underside of a gantry or a ledge over an open floor is too small to be one.
    """
    down, floor_area = {}, 0.0
    for obj in meshes:
        world = obj.matrix_world
        turn = world.to_3x3().inverted().transposed()
        grown = abs(world.to_3x3().determinant()) ** (2 / 3)
        for face in obj.data.polygons:
            area = face.area * grown
            if area < 0.05:
                continue
            facing = (turn @ face.normal).normalized().z
            if abs(facing) < 0.9:
                continue
            at = world @ face.center
            level = round(at.z * 4) / 4
            if facing > 0:
                if level == round(floor * 4) / 4:
                    floor_area += area
            elif floor + 1 <= at.z <= high.z + 0.1:
                down[level] = down.get(level, 0) + area
    if not down:
        return None, []
    whole = sum(down.values())
    largest = sorted(down.items(), key=lambda entry: -entry[1])[:5]
    # Over a floor with no surface of its own (one given by hand), the largest level stands in for it.
    enough = 0.3 * floor_area if floor_area else 0.5 * max(down.values())
    over = [level for level, area in down.items() if area >= enough]
    return (min(over) if over else None), [{"z": level, "share": round(area / whole, 2)} for level, area in largest]


def clamp_cut(z):
    return min(max(z, low.z + 0.1), high.z)


cut = clamp_cut(spec.get("cutZ", high.z))

if "shots" in spec:
    # Shots asked for one by one (set-shots): the ones with the set standing first, then the ones with the roof off.
    COMPASS = {"north": (0, 1), "east": (1, 0), "south": (0, -1), "west": (-1, 0)}
    written = []
    floor, levels = floor_levels()
    floor = spec.get("floor", floor)
    ceiling, ceilings = ceiling_levels(floor)
    # A cut asked for at a height is made there; else it is made just under the ceiling (whose level
    # is to a quarter cell), and where the set has no ceiling, at the set's own cut.
    if "shotCutZ" in spec:
        cut = clamp_cut(spec["shotCutZ"])
    elif ceiling is not None:
        cut = clamp_cut(ceiling - 0.2)
    for roofless in (False, True):
        if roofless and any(shot.get("cut") for shot in spec["shots"]):
            cut_roof(cut)
        for shot in spec["shots"]:
            if bool(shot.get("cut")) != roofless:
                continue
            name = shot["name"]
            if "compass" in shot:
                # Four looks from a standing point: the set's centre unless `at` says, this high over its floor.
                x, y = shot.get("at", (centre.x, centre.y))
                eye = (x, y, floor + shot["compass"])
                for way, (dx, dy) in COMPASS.items():
                    shoot("%s-%s" % (name, way), eye, (x + dx, y + dy, eye[2]), fov=shot.get("fov", 60))
                    written.append("%s-%s" % (name, way))
                continue
            if "orbit" in shot:
                orbit(name, shot["orbit"][0], shot["orbit"][1], fov=shot.get("fov", 35))
            elif shot.get("plan"):
                plan(name, cut if roofless else high.z)
            else:
                shoot(name, shot["eye"], shot["target"], fov=shot.get("fov", 40))
            written.append(name)
    json.dump({"min": list(low), "max": list(high), "drawn": drawn, "missing": missing, "cutZ": cut, "floor": floor, "levels": levels, "ceiling": ceiling, "ceilings": ceilings, "shots": written}, open(os.path.join(out, "shots.json"), "w"))
    raise SystemExit(0)

# The camera frames come first, with the whole set standing, as the game films it.
for index, cam in enumerate(spec["cameras"], 1):
    shoot("cam-%02d" % index, cam["eye"], cam["target"], fov=cam["fov"])

# Then the roof comes off, so the plan and the overview (from the south-east, down at 50 degrees) look into the room.
cut_roof(cut)
plan("plan", cut)
orbit("overview", 135, 50)

json.dump(
    {"version": VERSION, "min": list(low), "max": list(high), "drawn": drawn, "missing": missing, "cutZ": cut, "cameras": [c["name"] for c in spec["cameras"]]},
    open(os.path.join(out, "views.json"), "w"),
)
