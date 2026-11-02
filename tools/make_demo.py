"""Build Partcheck's demo packages: the made-up Smart Thermostat (Acme Climate) parts.

    python tools/make_demo.py

Writes demo/<package>/<files> and demo/demo-package.js (the same files embedded, so ?demo works
from disk). Everything is generated here: geometry, STEP, drawing PDFs, the flat-pattern DXF and
the BOM. No real part or client data. Standard library only.

The demo deliberately carries a few package problems for the checks to find:
  - back cover drawing: no finish callout, and its resin differs from the BOM;
  - back cover STEP: no revision in the file (only the file name has it);
  - wall bracket: the DXF flat pattern is still rev A (one hole fewer) while STEP and drawing are rev B.
"""
import base64, json, math, pathlib, zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "demo"

# ---------------------------------------------------------------- mesh helpers

class Mesh:
    def __init__(self):
        self.v, self.f, self.key = [], [], {}

    def vid(self, p):
        k = tuple(round(c, 6) for c in p)
        if k not in self.key:
            self.key[k] = len(self.v)
            self.v.append(k)
        return self.key[k]

    def poly(self, pts):
        ids = [self.vid(p) for p in pts]
        ids = [i for n, i in enumerate(ids) if i != ids[n - 1]]
        if len(ids) >= 3:
            self.f.append(ids)


def rrect(a, b, r, z, cx=0.0, cy=0.0, k=12):
    """Rounded rectangle loop, CCW, 4*k points, the same parametrization for every size."""
    pts = []
    for c, (sx, sy, a0) in enumerate([(1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)]):
        ox, oy = cx + sx * (a - r), cy + sy * (b - r)
        for i in range(k):
            t = math.radians(a0 + 90 * i / (k - 1))
            pts.append((ox + r * math.cos(t), oy + r * math.sin(t), z))
    return pts


def loft(mesh, loops):
    """Join a closed sequence of loops (a torus-like profile) with quads."""
    n = len(loops)
    for j in range(n):
        A, B = loops[j], loops[(j + 1) % n]
        m = len(A)
        for i in range(m):
            mesh.poly([A[i], A[(i + 1) % m], B[(i + 1) % m], B[i]])


def orient(mesh):
    """Make face windings consistent (BFS over shared edges), then outward (positive volume)."""
    edges = {}
    for fi, f in enumerate(mesh.f):
        for i in range(len(f)):
            a, b = f[i], f[(i + 1) % len(f)]
            edges.setdefault((min(a, b), max(a, b)), []).append(fi)
    bad = [e for e, fs in edges.items() if len(fs) != 2]
    if bad:
        raise SystemExit(f"mesh is not closed: {len(bad)} edges not shared by two faces")
    done = [False] * len(mesh.f)
    for s in range(len(mesh.f)):
        if done[s]:
            continue
        done[s] = True
        todo = [s]
        while todo:
            fi = todo.pop()
            f = mesh.f[fi]
            for i in range(len(f)):
                a, b = f[i], f[(i + 1) % len(f)]
                for g in edges[(min(a, b), max(a, b))]:
                    if g == fi or done[g]:
                        continue
                    h = mesh.f[g]
                    # a consistent neighbor runs the shared edge the other way (b -> a)
                    same = any(h[j] == a and h[(j + 1) % len(h)] == b for j in range(len(h)))
                    if same:
                        h.reverse()
                    done[g] = True
                    todo.append(g)
    if volume(mesh) < 0:
        for f in mesh.f:
            f.reverse()


def tris(mesh):
    for f in mesh.f:
        for i in range(1, len(f) - 1):
            yield f[0], f[i], f[i + 1]


def volume(mesh):
    v = mesh.v
    s = 0.0
    for a, b, c in tris(mesh):
        (x1, y1, z1), (x2, y2, z2), (x3, y3, z3) = v[a], v[b], v[c]
        s += (x1 * (y2 * z3 - y3 * z2) - x2 * (y1 * z3 - y3 * z1) + x3 * (y1 * z2 - y2 * z1)) / 6
    return s


def normal(pts):
    nx = ny = nz = 0.0
    for i in range(len(pts)):
        x1, y1, z1 = pts[i]
        x2, y2, z2 = pts[(i + 1) % len(pts)]
        nx += (y1 - y2) * (z1 + z2)
        ny += (z1 - z2) * (x1 + x2)
        nz += (x1 - x2) * (y1 + y2)
    l = math.sqrt(nx * nx + ny * ny + nz * nz) or 1
    return nx / l, ny / l, nz / l


def planar_faces(mesh):
    """Faces as STEP wants them: planar polygons; split non-planar quads into triangles."""
    out = []
    for f in mesh.f:
        pts = [mesh.v[i] for i in f]
        n = normal(pts)
        d0 = sum(n[k] * pts[0][k] for k in range(3))
        if len(f) == 3 or all(abs(sum(n[k] * p[k] for k in range(3)) - d0) < 1e-4 for p in pts):
            out.append(f)
        else:
            out.extend([f[0], f[i], f[i + 1]] for i in range(1, len(f) - 1))
    return out

# ---------------------------------------------------------------- polygon with holes (ear clipping)

def area2(poly):
    return sum(poly[i][0] * poly[i - 1][1] - poly[i - 1][0] * poly[i][1] for i in range(len(poly))) * -1


def bridge(outer, hole):
    """Splice a hole into the outer loop through a bridge from its rightmost point."""
    hi = max(range(len(hole)), key=lambda i: hole[i][0])
    hp = hole[hi]
    best, bd = None, 1e18
    for i, p in enumerate(outer):
        if p[0] < hp[0] - 1e-9:
            continue
        d = (p[0] - hp[0]) ** 2 + (p[1] - hp[1]) ** 2
        # the bridge must not cross any edge of the outer loop or the hole
        ok = True
        for poly in (outer, hole):
            for j in range(len(poly)):
                a, b = poly[j], poly[(j + 1) % len(poly)]
                if p in (a, b) or hp in (a, b):
                    continue
                if seg_cross(hp, p, a, b):
                    ok = False
                    break
            if not ok:
                break
        if ok and d < bd:
            best, bd = i, d
    i = best
    ring = hole[hi:] + hole[:hi]
    return outer[:i + 1] + ring + [ring[0], outer[i]] + outer[i + 1:]


def seg_cross(p, q, a, b):
    def o(u, v, w):
        return (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0])
    return o(p, q, a) * o(p, q, b) < 0 and o(a, b, p) * o(a, b, q) < 0


def earcut(outer, holes):
    """Triangulate a polygon (CCW outer, CW holes) by bridging the holes and clipping ears."""
    poly = list(outer)
    for h in sorted(holes, key=lambda h: -max(p[0] for p in h)):
        poly = bridge(poly, h)
    idx = list(range(len(poly)))
    out = []

    def cross(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    def inside(p, a, b, c):
        return cross(a, b, p) >= -1e-12 and cross(b, c, p) >= -1e-12 and cross(c, a, p) >= -1e-12

    guard = 0
    while len(idx) > 3 and guard < 100000:
        guard += 1
        n = len(idx)
        for k in range(n):
            ia, ib, ic = idx[k - 1], idx[k], idx[(k + 1) % n]
            a, b, c = poly[ia], poly[ib], poly[ic]
            if cross(a, b, c) <= 1e-12:
                continue
            if any(inside(poly[j], a, b, c) for j in idx if poly[j] not in (a, b, c)):
                continue
            out.append((a, b, c))
            idx.pop(k)
            break
        else:
            raise SystemExit("earcut failed")
    out.append(tuple(poly[j] for j in idx))
    return out


def circle(cx, cy, r, n=24, cw=True):
    pts = [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    return pts[::-1] if cw else pts


def obround(cx, cy, length, width, n=10, cw=True):
    r = width / 2
    pts = []
    for s in (1, -1):
        ox = cx + s * (length / 2 - r)
        for i in range(n):
            t = math.radians(-90 + 180 * i / (n - 1)) if s == 1 else math.radians(90 + 180 * i / (n - 1))
            pts.append((ox + r * math.cos(t), cy + r * math.sin(t)))
    return pts[::-1] if cw else pts


def rrect2(a, b, r, cx=0.0, cy=0.0, k=8, cw=True):
    pts = [(x, y) for x, y, _ in rrect(a, b, r, 0, cx, cy, k)]
    return pts[::-1] if cw else pts

# ---------------------------------------------------------------- the parts

DRAFT = math.tan(math.radians(1.5))


def front_cover():
    """PC/ABS front cover: 90 x 90 x 14 mm shell, 2 mm wall, 1.5 deg draft, display window with a
    thicker 3.5 mm bezel (a sink risk the thickness view shows)."""
    H, t, A, R = 14.0, 2.0, 45.0, 10.0
    d = lambda z: z * DRAFT
    o = lambda z, inset=0.0: rrect(A - d(z) - inset, A - d(z) - inset, R - inset, z)
    win = dict(cx=0.0, cy=8.0)
    loops = [
        o(0.0),
        o(H - 2.0),
        o(H - 0.586, 0.586),
        o(H, 2.0),
        rrect(37, 27, 7, H, **win),
        rrect(30, 20, 4.5, H, **win),
        rrect(26, 16, 3, H, **win),
        rrect(26, 16, 3, H - 3.5, **win),
        rrect(29.5, 19.5, 4.5, H - 3.5, **win),
        rrect(33, 23, 6, H - 3.5, **win),
        rrect(33, 23, 6, H - t, **win),
        rrect(A - t - d(H - t), A - t - d(H - t), R - t, H - t),
        rrect(A - t, A - t, R - t, 0.0),
    ]
    m = Mesh()
    loft(m, loops)
    orient(m)
    return m


def back_cover():
    """PC/ABS back cover: 90 x 90 x 10 mm, wire pass-through, outer wall drafted 1.5 deg but the
    inner wall left at zero draft (the draft view shows it red)."""
    H, t, A, R = 10.0, 2.0, 45.0, 10.0
    d = lambda z: z * DRAFT
    hole = dict(cx=0.0, cy=-6.0)
    loops = [
        rrect(A, A, R, 0.0),
        rrect(A - d(H), A - d(H), R, H),
        rrect(A - t, A - t, R - t, H),
        rrect(A - t, A - t, R - t, t),
        rrect(14, 9, 3, t, **hole),
        rrect(14, 9, 3, 0.0, **hole),
    ]
    m = Mesh()
    loft(m, loops)
    orient(m)
    return m


BR = dict(W=35.0, L=55.0, t=1.2, R=1.2, h=6.0, tab=15.0)


def bracket_holes(rev):
    holes = [
        rrect2(15, 10, 3),                                   # wire pass-through
        obround(0, 41.75, 9, 4.2), obround(0, -41.75, 9, 4.2),  # box screws, 83.5 mm
        circle(-25, 0, 2.25), circle(25, 0, 2.25),           # drywall anchors
    ]
    if rev == "B":
        holes.append(circle(0, 50.0, 1.75))                  # catch-alignment hole, close to the bend
    return holes


def bracket():
    """Steel wall bracket rev B: 70 x 110 x 1.2 mm plate, two 90 deg catch tabs, six holes."""
    W, L, t, R, h, tab = (BR[k] for k in ("W", "L", "t", "R", "h", "tab"))
    r = 4.0
    k = 6
    outer = []
    # CCW rounded rectangle with straight-edge vertices at x = +-tab on the top and bottom edges
    def arc(cx, cy, a0):
        return [(cx + r * math.cos(math.radians(a0 + 90 * i / (k - 1))), cy + r * math.sin(math.radians(a0 + 90 * i / (k - 1)))) for i in range(k)]
    outer += arc(W - r, L - r, 0)
    outer += [(tab, L), (-tab, L)]
    outer += arc(-W + r, L - r, 90)
    outer += arc(-W + r, -L + r, 180)
    outer += [(-tab, -L), (tab, -L)]
    outer += arc(W - r, -L + r, 270)
    holes = bracket_holes("B")
    m = Mesh()
    for a, b, c in earcut(outer, holes):
        m.poly([(a[0], a[1], t), (b[0], b[1], t), (c[0], c[1], t)])
        m.poly([(c[0], c[1], 0), (b[0], b[1], 0), (a[0], a[1], 0)])
    skip = {((tab, L), (-tab, L)), ((-tab, -L), (tab, -L))}
    for loop in [outer] + holes:
        for i in range(len(loop)):
            a, b = loop[i], loop[(i + 1) % len(loop)]
            if (a, b) in skip:
                continue
            m.poly([(a[0], a[1], 0), (b[0], b[1], 0), (b[0], b[1], t), (a[0], a[1], t)])
    # tabs: bend up 90 deg about the plate edge, inside radius R, then straight to height h
    for sy in (1, -1):
        prof = []  # (inner, outer) pairs in (y, z), from the plate edge outward
        n = 8
        for i in range(n + 1):
            ph = math.radians(90 * i / n)
            cy, cz = L, t + R
            prof.append(((cy + R * math.sin(ph), cz - R * math.cos(ph)), (cy + (R + t) * math.sin(ph), cz - (R + t) * math.cos(ph))))
        prof.append(((L + R, h), (L + R + t, h)))
        P = lambda yz, x: (x, sy * yz[0], yz[1])
        for i in range(len(prof) - 1):
            (i0, o0), (i1, o1) = prof[i], prof[i + 1]
            m.poly([P(i0, -tab), P(i0, tab), P(i1, tab), P(i1, -tab)])
            m.poly([P(o0, -tab), P(o1, -tab), P(o1, tab), P(o0, tab)])
            for x in (-tab, tab):
                m.poly([P(i0, x), P(o0, x), P(o1, x), P(i1, x)])
        (ie, oe) = prof[-1]
        m.poly([P(ie, -tab), P(oe, -tab), P(oe, tab), P(ie, tab)])
    orient(m)
    return m


def bracket_flat(rev):
    """Flat blank for the DXF: tabs unfolded with K = 0.44."""
    W, L, t, R, h, tab = (BR[k] for k in ("W", "L", "t", "R", "h", "tab"))
    ba = math.pi / 2 * (R + 0.44 * t)
    ext = ba + (h - (R + t))
    lines = []
    r = 4.0
    pts = [(W, L - r), (W, -L + r)]
    out = [
        ("LINE", (W, -L + r, W, L - r)), ("ARC", (W - r, L - r, r, 0, 90)), ("LINE", (W - r, L, tab, L)),
        ("LINE", (tab, L, tab, L + ext)), ("LINE", (tab, L + ext, -tab, L + ext)), ("LINE", (-tab, L + ext, -tab, L)),
        ("LINE", (-tab, L, -W + r, L)), ("ARC", (-W + r, L - r, r, 90, 180)), ("LINE", (-W, L - r, -W, -L + r)),
        ("ARC", (-W + r, -L + r, r, 180, 270)), ("LINE", (-W + r, -L, -tab, -L)), ("LINE", (-tab, -L, -tab, -L - ext)),
        ("LINE", (-tab, -L - ext, tab, -L - ext)), ("LINE", (tab, -L - ext, tab, -L)), ("LINE", (tab, -L, W - r, -L)),
        ("ARC", (W - r, -L + r, r, 270, 360)),
    ]
    for kind, d in out:
        lines.append((kind, "0", d))
    for sy in (1, -1):
        y = sy * (L + ba / 2)
        lines.append(("LINE", "BEND", (-tab, y, tab, y)))
    for hole in bracket_holes(rev):
        for i in range(len(hole)):
            a, b = hole[i], hole[(i + 1) % len(hole)]
            lines.append(("LINE", "0", (a[0], a[1], b[0], b[1])))
    return lines, 2 * W, 2 * (L + ext)


def dxf(entities, part, rev):
    s = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009", "9", "$INSUNITS", "70", "4", "0", "ENDSEC",
         "0", "SECTION", "2", "ENTITIES",
         "0", "TEXT", "8", "NOTES", "10", "-30", "20", "-80", "40", "3", "1", f"{part} REV {rev} FLAT PATTERN"]
    for kind, layer, d in entities:
        if kind == "LINE":
            s += ["0", "LINE", "8", layer, "10", f"{d[0]:.4f}", "20", f"{d[1]:.4f}", "11", f"{d[2]:.4f}", "21", f"{d[3]:.4f}"]
        else:
            s += ["0", "ARC", "8", layer, "10", f"{d[0]:.4f}", "20", f"{d[1]:.4f}", "40", f"{d[2]:.4f}", "50", f"{d[3]:.1f}", "51", f"{d[4]:.1f}"]
    s += ["0", "ENDSEC", "0", "EOF"]
    return "\r\n".join(s) + "\r\n"

# ---------------------------------------------------------------- STEP (AP214, faceted b-rep)

def step(mesh, part, rev, name, filename, author, when):
    lines, n = [], [0]

    def e(text):
        n[0] += 1
        lines.append(f"#{n[0]}={text};")
        return n[0]

    ctx = e("APPLICATION_CONTEXT('core data for automotive mechanical design processes')")
    e(f"APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#{ctx})")
    pc = e(f"PRODUCT_CONTEXT('',#{ctx},'mechanical')")
    prod = e(f"PRODUCT('{part}','{name}','',(#{pc}))")
    pdf_ = e(f"PRODUCT_DEFINITION_FORMATION('{rev}','',#{prod})")
    pdc = e(f"PRODUCT_DEFINITION_CONTEXT('part definition',#{ctx},'design')")
    pd = e(f"PRODUCT_DEFINITION('design','',#{pdf_},#{pdc})")
    pds = e(f"PRODUCT_DEFINITION_SHAPE('','',#{pd})")
    lu = e("(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))")
    au = e("(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))")
    su = e("(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())")
    unc = e(f"UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#{lu},'distance_accuracy_value','confusion accuracy')")
    gc = e(f"(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#{unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#{lu},#{au},#{su}))REPRESENTATION_CONTEXT('',''))")
    o = e("CARTESIAN_POINT('',(0.,0.,0.))")
    dz = e("DIRECTION('',(0.,0.,1.))")
    dx = e("DIRECTION('',(1.,0.,0.))")
    ax = e(f"AXIS2_PLACEMENT_3D('',#{o},#{dz},#{dx})")
    pts = [e("CARTESIAN_POINT('',(%s))" % ",".join(f"{c:.6f}" for c in p)) for p in mesh.v]
    faces = []
    for f in planar_faces(mesh):
        P = [mesh.v[i] for i in f]
        nn = normal(P)
        ref = [P[1][k] - P[0][k] for k in range(3)]
        rl = math.sqrt(sum(c * c for c in ref)) or 1
        ndir = e("DIRECTION('',(%s))" % ",".join(f"{c:.9f}" for c in nn))
        rdir = e("DIRECTION('',(%s))" % ",".join(f"{c / rl:.9f}" for c in ref))
        pax = e(f"AXIS2_PLACEMENT_3D('',#{pts[f[0]]},#{ndir},#{rdir})")
        pl = e(f"PLANE('',#{pax})")
        loop = e("POLY_LOOP('',(%s))" % ",".join(f"#{pts[i]}" for i in f))
        bound = e(f"FACE_OUTER_BOUND('',#{loop},.T.)")
        faces.append(e(f"FACE_SURFACE('',(#{bound}),#{pl},.T.)"))
    shell = e("CLOSED_SHELL('',(%s))" % ",".join(f"#{x}" for x in faces))
    brep = e(f"FACETED_BREP('{name}',#{shell})")
    rep = e(f"FACETED_BREP_SHAPE_REPRESENTATION('',(#{ax},#{brep}),#{gc})")
    e(f"SHAPE_DEFINITION_REPRESENTATION(#{pds},#{rep})")
    head = ["ISO-10303-21;", "HEADER;",
            f"FILE_DESCRIPTION(('{name}'),'2;1');",
            f"FILE_NAME('{filename}','{when}',('{author}'),('Acme Climate'),'Partcheck demo generator','Partcheck demo','');",
            "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));", "ENDSEC;", "DATA;"]
    return "\n".join(head + lines + ["ENDSEC;", "END-ISO-10303-21;"]) + "\n"

# ---------------------------------------------------------------- drawing PDF

def feature_edges(mesh, angle=25):
    ed = {}
    for f in mesh.f:
        nn = normal([mesh.v[i] for i in f])
        for i in range(len(f)):
            a, b = f[i], f[(i + 1) % len(f)]
            ed.setdefault((min(a, b), max(a, b)), []).append(nn)
    c = math.cos(math.radians(angle))
    return [k for k, ns in ed.items() if len(ns) != 2 or sum(ns[0][j] * ns[1][j] for j in range(3)) < c]


def pdf_escape(s):
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)").encode("cp1252", "replace").decode("latin-1")


class Page:
    W, H = 1224, 792  # ANSI B landscape, points

    def __init__(self):
        self.ops = []

    def line(self, x1, y1, x2, y2, w=0.6):
        self.ops.append(f"{w} w {x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S")

    def rect(self, x, y, w, h, lw=0.8):
        self.ops.append(f"{lw} w {x:.2f} {y:.2f} {w:.2f} {h:.2f} re S")

    def text(self, x, y, s, size=8, bold=False):
        self.ops.append(f"BT /{'F2' if bold else 'F1'} {size} Tf {x:.2f} {y:.2f} Td ({pdf_escape(s)}) Tj ET")

    def pdf(self):
        content = zlib.compress("\n".join(self.ops).encode("latin-1"))
        objs = [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {self.W} {self.H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>".encode(),
            f"<< /Length {len(content)} /Filter /FlateDecode >>\nstream\n".encode() + content + b"\nendstream",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
            b"<< /Title (Partcheck demo drawing) /Producer (Partcheck demo generator) >>",
        ]
        out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offs = []
        for i, o in enumerate(objs):
            offs.append(len(out))
            out += f"{i + 1} 0 obj\n".encode() + o + b"\nendobj\n"
        x = len(out)
        out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
        for o in offs:
            out += f"{o:010d} 00000 n \n".encode()
        out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n{x}\n%%EOF\n".encode()
        return bytes(out)


def drawing(mesh, d):
    p = Page()
    W, H = p.W, p.H
    p.rect(20, 20, W - 40, H - 40, 1.4)
    # views (third angle): front (X-Y, looking down -Z), top (X-Z) above, right (Z-Y) to the right
    xs = [v[0] for v in mesh.v]; ys = [v[1] for v in mesh.v]; zs = [v[2] for v in mesh.v]
    bx, by, bz = max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)
    s = min(430 / (bx + bz + 40), 430 / (by + bz + 40), 3.0)
    s = 2.0 if s >= 2.0 else (1.5 if s >= 1.5 else 1.0)
    fx, fy = 120, 110
    ed = feature_edges(mesh)
    views = [
        (lambda v: (fx + (v[0] - min(xs)) * s, fy + (v[1] - min(ys)) * s)),
        (lambda v: (fx + (v[0] - min(xs)) * s, fy + by * s + 50 + (v[2] - min(zs)) * s)),
        (lambda v: (fx + bx * s + 50 + (max(zs) - v[2]) * s, fy + (v[1] - min(ys)) * s)),
    ]
    for proj in views:
        seen = set()
        for a, b in ed:
            P, Q = proj(mesh.v[a]), proj(mesh.v[b])
            k = (round(P[0], 1), round(P[1], 1), round(Q[0], 1), round(Q[1], 1))
            if k in seen or (abs(P[0] - Q[0]) < 0.05 and abs(P[1] - Q[1]) < 0.05):
                continue
            seen.add(k)
            p.line(P[0], P[1], Q[0], Q[1], 0.5)
    # overall dimensions
    def dim_h(x1, x2, y, label):
        p.line(x1, y, x2, y, 0.4); p.line(x1, y - 4, x1, y + 4, 0.4); p.line(x2, y - 4, x2, y + 4, 0.4)
        p.text((x1 + x2) / 2 - 12, y + 3, label, 8)
    def dim_v(x, y1, y2, label):
        p.line(x, y1, x, y2, 0.4); p.line(x - 4, y1, x + 4, y1, 0.4); p.line(x - 4, y2, x + 4, y2, 0.4)
        p.text(x - 34, (y1 + y2) / 2, label, 8)
    dim_h(fx, fx + bx * s, fy - 22, f"{bx:.1f}")
    dim_v(fx - 22, fy, fy + by * s, f"{by:.1f}")
    dim_v(fx + bx * s + 30, fy + by * s + 50, fy + by * s + 50 + bz * s, f"{bz:.1f}")
    p.text(fx, fy - 45, "FRONT", 8, True)
    p.text(fx, fy + by * s + 50 + bz * s + 10, "TOP", 8, True)
    p.text(fx + bx * s + 50, fy - 45, "RIGHT", 8, True)
    # notes
    ny = H - 60
    p.text(700, ny, "NOTES:", 9, True)
    for i, n in enumerate(d["notes"]):
        p.text(700, ny - 16 * (i + 1), f"{i + 1}. {n}", 8)
    # revision table (top right)
    rx, ry = W - 380, H - 40
    p.rect(rx, ry - 14 - 14 * len(d["revs"]), 360, 14 + 14 * len(d["revs"]))
    p.text(rx + 4, ry - 10, "REV", 7, True); p.text(rx + 40, ry - 10, "DESCRIPTION", 7, True)
    p.text(rx + 240, ry - 10, "DATE", 7, True); p.text(rx + 300, ry - 10, "ECO", 7, True)
    for i, (r, desc, date, eco) in enumerate(d["revs"]):
        y = ry - 24 - 14 * i
        p.text(rx + 4, y, r, 7); p.text(rx + 40, y, desc, 7); p.text(rx + 240, y, date, 7); p.text(rx + 300, y, eco, 7)
    # title block (bottom right): cells with a small label and the value under it
    tx, ty, tw = W - 520, 20, 500
    p.rect(tx, ty, tw, 170)
    def cell(x, y, w, h, label, value, size=9):
        p.rect(x, y, w, h, 0.6)
        p.text(x + 3, y + h - 8, label, 5.5)
        if value:
            p.text(x + 3, y + 5, value, size, True)
    cell(tx, ty + 140, 330, 30, "TITLE", d["title"], 11)
    cell(tx + 330, ty + 140, 170, 30, "COMPANY", "ACME CLIMATE", 9)
    cell(tx, ty + 112, 200, 28, "PART NO.", d["part"], 11)
    cell(tx + 200, ty + 112, 50, 28, "REV", d["rev"], 11)
    cell(tx + 250, ty + 112, 80, 28, "SCALE", f"{s:g}:1")
    cell(tx + 330, ty + 112, 80, 28, "SHEET", "1 OF 1")
    cell(tx + 410, ty + 112, 90, 28, "SIZE", "B")
    cell(tx, ty + 84, 330, 28, "MATERIAL", d["material"], 7.5)
    cell(tx + 330, ty + 84, 170, 28, "MASS", d.get("mass", ""), 8)
    cell(tx, ty + 56, 330, 28, "FINISH", d.get("finish", ""), 7.5)
    cell(tx + 330, ty + 56, 170, 28, "UNITS", "MILLIMETERS [MM]", 8)
    cell(tx, ty + 28, 110, 28, "DRAWN", d["drawn"], 7.5)
    cell(tx + 110, ty + 28, 110, 28, "CHECKED", d["checked"], 7.5)
    cell(tx + 220, ty + 28, 110, 28, "APPROVED", d.get("approved", ""), 7.5)
    cell(tx + 330, ty + 28, 170, 28, "PROJECTION", "THIRD ANGLE PROJECTION", 7)
    p.rect(tx, ty, 500, 28, 0.6)
    p.text(tx + 3, ty + 18, "UNLESS OTHERWISE SPECIFIED: DIMENSIONS IN MM.  TOLERANCES: X.X ±0.2   X.XX ±0.10   ANGLES ±0.5°", 6.5)
    p.text(tx + 3, ty + 7, "INTERPRET DIMENSIONS AND TOLERANCES PER ASME Y14.5-2018.  BREAK SHARP EDGES 0.2 MAX.", 6.5)
    return p.pdf()

# ---------------------------------------------------------------- packages

DENSITY = {"pcabs": 1.15, "steel": 7.85}


def build():
    fc, bc, br = front_cover(), back_cover(), bracket()
    vol = {k: volume(m) for k, m in (("fc", fc), ("bc", bc), ("br", br))}
    g = lambda k, rho: f"{vol[k] * rho / 1000:.1f} g"
    when = "2026-10-28T09:30:00"
    enc = {
        "2100410-011_B_front-cover.step": step(fc, "2100410-011", "B", "Front Cover", "2100410-011_B_front-cover.step", "Dana Kim", when),
        "2100410-012_B_back-cover.step": step(bc, "2100410-012", "", "Back Cover", "2100410-012_B_back-cover.step", "Dana Kim", when),
        "2100410-011_B_front-cover.pdf": drawing(fc, dict(
            title="FRONT COVER, SMART THERMOSTAT", part="2100410-011", rev="B",
            material="PC/ABS, SABIC CYCOLOY C1200HF, WHITE (CMF-01)", finish="MT-11010 TEXTURE ON A-SURFACES, SPI A-2 DISPLAY BEZEL",
            mass=g("fc", DENSITY["pcabs"]), drawn="D. KIM 2026-10-20", checked="L. ALVAREZ 2026-10-24", approved="",
            revs=[("A", "INITIAL RELEASE FOR PROTOTYPE", "2026-08-12", "ECO-0107"), ("B", "WINDOW BEZEL 3.5 MM, SNAP CATCHES MOVED", "2026-10-24", "ECO-0131")],
            notes=["MOLD DRAFT 1° MIN ON ALL WALLS UNLESS SHOWN.", "NOMINAL WALL 2.0 MM.", "GATE AND EJECTOR WITNESS NOT PERMITTED ON A-SURFACES.",
                   "COSMETIC CLASS A PER DT-SPEC-12 SECTION 7.", "MARK PART NO., REV, CAVITY ID AND RESIN ID (>PC+ABS<) INSIDE."])),
        "2100410-012_B_back-cover.pdf": drawing(bc, dict(
            title="BACK COVER, SMART THERMOSTAT", part="2100410-012", rev="B",
            material="PC/ABS, SABIC CYCOLOY C1200HF, WHITE (CMF-01)", finish="",
            mass=g("bc", DENSITY["pcabs"]), drawn="D. KIM 2026-10-20", checked="L. ALVAREZ 2026-10-24", approved="",
            revs=[("A", "INITIAL RELEASE FOR PROTOTYPE", "2026-08-12", "ECO-0107"), ("B", "WIRE OPENING ENLARGED", "2026-10-24", "ECO-0131")],
            notes=["MOLD DRAFT 1° MIN ON ALL WALLS UNLESS SHOWN.", "NOMINAL WALL 2.0 MM.", "MARK PART NO., REV, CAVITY ID AND RESIN ID (>PC+ABS<) INSIDE."])),
        "BOM_2100410-001_B_enclosure.csv": "\r\n".join([
            "Item,Part Number,Rev,Description,Type,Material,Finish,Qty",
            "1,2100410-011,B,Front cover,Molded,\"PC/ABS, SABIC Cycoloy C1200HF, white (CMF-01)\",MT-11010 texture,1",
            "2,2100410-012,B,Back cover,Molded,\"PC/ABS, Covestro Bayblend T85 XF, white (CMF-01)\",MT-11010 texture,1",
            "3,2100410-031,A,Light pipe,Molded,\"PC, clear\",SPI A-1,1",
            "4,9100022-004,,Screw M2.5 x 6 thread-forming for plastics,Purchased,Steel,Zinc,4",
        ]) + "\r\n",
    }
    flat, fw, fh = bracket_flat("A")
    brk = {
        "2100410-020_B_wall-bracket.step": step(br, "2100410-020", "B", "Wall Bracket", "2100410-020_B_wall-bracket.step", "Lee Alvarez", when),
        "2100410-020_B_wall-bracket.pdf": drawing(br, dict(
            title="WALL BRACKET, SMART THERMOSTAT", part="2100410-020", rev="B",
            material="STEEL, CR, SAE 1008, 1.2 MM (0.047 IN)", finish="ZINC PLATE, CLEAR TRIVALENT, ASTM B633 TYPE II SC1, AFTER FORMING",
            mass=g("br", DENSITY["steel"]), drawn="L. ALVAREZ 2026-10-22", checked="D. KIM 2026-10-25", approved="",
            revs=[("A", "INITIAL RELEASE", "2026-09-30", "ECO-0119"), ("B", "ADDED CATCH ALIGNMENT HOLE", "2026-10-25", "ECO-0134")],
            notes=["BENDS: UP 90° R1.2 INSIDE, TYP 2 PLACES.", "FLAT PATTERN: SEE DXF, K-FACTOR 0.44.", "REMOVE ALL BURRS. BURR SIDE AWAY FROM WALL.",
                   "HOLE PATTERN FITS SINGLE-GANG BOX, 83.5 MM SCREW SPACING."])),
        "2100410-020_A_wall-bracket_flat.dxf": dxf(flat, "2100410-020", "A"),
    }
    packages = [
        {"id": "enclosure", "name": "Enclosure rev B (to the molder)", "files": enc},
        {"id": "bracket", "name": "Wall bracket rev B (to the sheet-metal shop)", "files": brk},
    ]
    OUT.mkdir(exist_ok=True)
    embed = []
    for pk in packages:
        d = OUT / pk["id"]
        d.mkdir(exist_ok=True)
        files = []
        for name, body in pk["files"].items():
            data = body if isinstance(body, bytes) else body.encode("utf-8")
            (d / name).write_bytes(data)
            files.append({"path": name, "b64": base64.b64encode(data).decode()})
        embed.append({"id": pk["id"], "name": pk["name"], "files": files})
    js = ("// Generated by tools/make_demo.py: the made-up Smart Thermostat parts, embedded so ?demo works from disk.\n"
          "window.PartcheckDemo = " + json.dumps({"project": "Smart Thermostat", "client": "Acme Climate", "packages": embed}) + ";\n")
    (OUT / "demo-package.js").write_text(js, encoding="utf-8")
    for k, m in (("front cover", fc), ("back cover", bc), ("bracket", br)):
        print(f"{k}: {len(m.v)} vertices, {len(m.f)} faces, {volume(m) / 1000:.2f} cm3")
    print(f"flat blank {fw:.1f} x {fh:.1f} mm; demo-package.js {len(js) / 1024:.0f} kB")


if __name__ == "__main__":
    build()
