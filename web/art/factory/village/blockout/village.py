# Village blockout: horseshoe around the plaza, every door facing the plaza; renders a labelled plan view.
import bpy, math, sys, random
from mathutils import Vector
OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '.'
bpy.ops.wm.read_factory_settings(use_empty=True)
S = bpy.context.scene
def mat(name, rgb, emit=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = 0.8
    if emit: b.inputs['Emission Color'].default_value = (*rgb, 1); b.inputs['Emission Strength'].default_value = emit
    return m
M = dict(ground=mat('ground', (0.20, 0.30, 0.14)), stone=mat('stone', (0.55, 0.50, 0.42)), bldg=mat('bldg', (0.78, 0.74, 0.68)),
         roof=mat('roof', (0.35, 0.22, 0.16)), door=mat('door', (0.9, 0.08, 0.05), 2.0), water=mat('water', (0.10, 0.22, 0.35)),
         tree=mat('tree', (0.08, 0.20, 0.08)), plot=mat('plot', (0.45, 0.38, 0.25)), bronze=mat('bronze', (0.55, 0.35, 0.12)), text=mat('text', (1, 0.95, 0.8), 3.0))
def put(o, m): o.data.materials.append(m); return o
def box(x, y, z, sx, sy, sz, m, rot=0):
    bpy.ops.mesh.primitive_cube_add(location=(x, y, z + sz / 2), rotation=(0, 0, rot)); o = bpy.context.object; o.scale = (sx / 2, sy / 2, sz / 2); return put(o, m)
def cyl(x, y, r, h, m, z=0, v=48):
    bpy.ops.mesh.primitive_cylinder_add(vertices=v, radius=r, depth=h, location=(x, y, z + h / 2)); return put(bpy.context.object, m)
LABELS = []
def label(t, x, y, z, size=1.4):
    LABELS.append((t, x, y, z))

# ground, plaza, sculpture
box(0, 0, -0.2, 220, 220, 0.2, M['ground'])
cyl(0, 0, 7, 0.15, M['stone'])
cyl(0, 0, 2, 0.8, M['stone'], z=0.15)
bpy.ops.mesh.primitive_torus_add(major_radius=1.0, minor_radius=0.28, location=(-0.9, 0, 2.2), rotation=(math.radians(90), 0, 0)); put(bpy.context.object, M['bronze'])
bpy.ops.mesh.primitive_torus_add(major_radius=1.0, minor_radius=0.28, location=(0.9, 0, 2.2), rotation=(math.radians(90), 0, 0)); put(bpy.context.object, M['bronze'])

def path(a, b, w=2.6):
    a, b = Vector(a), Vector(b); d = b - a
    box((a.x + b.x) / 2, (a.y + b.y) / 2, 0, w, d.length, 0.12, M['stone'], rot=math.atan2(d.y, d.x) - math.pi / 2)

# buildings: (name, angle from +y around the plaza (deg), distance, width, depth, height); each turned to face the plaza
B = [('WORKSHOP', 0, 15, 13, 8, 7.5), ('ARCADE', 52, 15, 8, 6, 5), ('TROPHY HALL', -52, 15, 8, 6.5, 5.5),
     ('MARKETPLACE', 92, 15.5, 9, 6.5, 5), ('MORNING WOOD', -92, 15, 6, 5, 6)]
for name, ang, dist, w, d, h in B:
    a = math.radians(ang); cx, cy = dist * math.sin(a), dist * math.cos(a)
    # the side buildings face the front of the plaza (where the road comes in), so their doors turn toward the camera
    tx, ty = (0, -7) if abs(ang) > 80 else (0, 0)
    face = math.atan2(ty - cy, tx - cx)
    rot = face + math.pi / 2     # the box's -y face (its front) points at the plaza
    lift = 1.0 if name == 'WORKSHOP' else 0.0
    if lift: box(cx, cy, 0, w + 6, d + 6, lift, M['stone'], rot=rot)
    box(cx, cy, lift, w, d, h, M['bldg'], rot=rot)
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=max(w, d) * 0.72, depth=h * 0.45, location=(cx, cy, lift + h + h * 0.22), rotation=(0, 0, rot + math.pi / 4))
    put(bpy.context.object, M['roof'])
    fx, fy = math.cos(face), math.sin(face)  # front direction
    dx, dy = cx + fx * (d / 2 + 0.05), cy + fy * (d / 2 + 0.05)
    box(dx, dy, lift, 1.6, 0.3, 2.6, M['door'], rot=rot)
    # a path from the door to the plaza's edge
    pc = Vector((tx, ty)) if abs(ang) > 80 else Vector((0, 0)); dv = (pc - Vector((dx, dy))); end = Vector((dx, dy)) + dv * max(0, (dv.length - 6.6) / dv.length) if pc.length == 0 else Vector((dx, dy)) + dv.normalized() * (Vector((dx, dy)).length - 6.6)
    path((dx + fx * 0.3, dy + fy * 0.3), (end.x, end.y))
    label(name, cx, cy, lift + h * 1.5 + 1.5)

# expansion plots up the hill (they face the plaza too)
for x, y in [(-22, 20), (22, 20)]:
    box(x, y, 0, 8, 6, 0.25, M['plot']); label('FUTURE PLOT', x, y, 1.0)
    path((x * 0.62, y * 0.62), (x * 0.9, y * 0.9), 2)

# main road, stream, bridge
path((0, -7), (0, -30), 3.6)
box(0, -19, -0.05, 220, 5, 0.1, M['water'])
box(0, -19, 0.1, 5, 6.5, 0.6, M['stone'])

# forest at the edges only (never in front of a door or path)
random.seed(4)
for _ in range(700):
    x, y = random.uniform(-70, 70), random.uniform(-80, 75)
    r = math.hypot(x, y * 1.15)
    if r < 27 or abs(y + 19) < 3.5 or (abs(x) < 4 and y < -6): continue
    s = random.uniform(1.4, 2.6)
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=s, depth=s * 3, location=(x, y, s * 1.5)); put(bpy.context.object, M['tree'])

# light: dusk sun from the upper left, soft sky
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); S.collection.objects.link(sun)
sun.data.energy = 3.5; sun.data.color = (1.0, 0.78, 0.55); sun.rotation_euler = (math.radians(55), math.radians(-25), math.radians(-40))
S.world = bpy.data.worlds.new('w'); S.world.use_nodes = True; S.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.25, 0.22, 0.3, 1)
S.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); S.collection.objects.link(cam); S.camera = cam
cam.data.type = 'ORTHO'
S.render.engine = 'CYCLES'; S.cycles.samples = 24; S.cycles.device = 'CPU'
def shot(name, w, h, scale, ty):
    S.render.resolution_x, S.render.resolution_y = w, h
    cam.data.ortho_scale = scale
    pitch = math.radians(50)  # looking down 40 degrees below level
    cam.rotation_euler = (pitch, 0, 0)
    cam.location = (0, ty - 60 * math.cos(pitch), 60 * math.sin(pitch) + 0) if False else (0, ty - 60 * math.sin(pitch), 60 * math.cos(pitch))
    S.render.filepath = f'{OUT}/{name}.png'; bpy.ops.render.render(write_still=True)
    from bpy_extras.object_utils import world_to_camera_view
    import json
    bpy.context.view_layer.update()
    pts = [{'t': t, 'x': world_to_camera_view(S, cam, Vector((x, y, z))).x * w, 'y': (1 - world_to_camera_view(S, cam, Vector((x, y, z))).y) * h} for t, x, y, z in LABELS]
    json.dump(pts, open(f'{OUT}/{name}.json', 'w'))
shot('plan-desktop', 1600, 900, 84, 7)
shot('plan-phone', 720, 1280, 72, 1)
bpy.ops.wm.save_as_mainfile(filepath=f'{OUT}/village-blockout.blend')
print('done')
