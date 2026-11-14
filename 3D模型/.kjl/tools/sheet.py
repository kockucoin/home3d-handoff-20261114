# usage: python3 -I sheet.py <result.json> <out_prefix>
# prints compact product list; writes one contact sheet per queryId (<out_prefix>-<qid>.jpg)
import json, sys, base64, io
from PIL import Image, ImageDraw
src, pre = sys.argv[1], sys.argv[2]
j = json.load(open(src))
c = j['data']['data']['content']
t = json.loads(c[0]['text'])['data']
man = j['data']['data'].get('structuredContent', {}).get('data', {}).get('imageManifest') or t.get('imageManifest') or []
imgs = {}
for m in man:
    ci = m.get('contentIndex')
    if ci is not None and ci < len(c) and c[ci].get('data'):
        imgs[(m['queryId'], m['resultIndex'])] = Image.open(io.BytesIO(base64.b64decode(c[ci]['data']))).convert('RGB')
for r in t['results']:
    q = r['queryId']; tiles = []
    for i, p in enumerate(r.get('products') or []):
        sd = p.get('searchData') or {}; s = sd.get('size') or {}
        ok = (p.get('permissions') or {}).get('raw', {}).get('usable', True)
        print(f"{q}#{i} {p.get('productId')} {sd.get('categoryName','')} | {p.get('name','')[:30]} | {round(s.get('x',0))}x{round(s.get('y',0))}x{round(s.get('z',0))}{'' if ok else ' UNUSABLE'}")
        im = imgs.get((q, i))
        if im: im = im.resize((200, 200)); d = ImageDraw.Draw(im); d.rectangle((0, 0, 28, 20), fill='black'); d.text((4, 4), str(i), fill='white'); tiles.append(im)
    if tiles:
        cols = min(4, len(tiles)); rows = (len(tiles) + cols - 1) // cols
        sh = Image.new('RGB', (cols * 200, rows * 200), 'white')
        for k, im in enumerate(tiles): sh.paste(im, ((k % cols) * 200, (k // cols) * 200))
        sh.thumbnail((720, 720)); sh.save(f"{pre}-{q}.jpg", quality=70)
