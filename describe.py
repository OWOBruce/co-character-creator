"""Describe every piece from its rendered sheets with Claude Sonnet 5.5 through the Message Batches API.

    python describe.py plan               how many requests and batches, rough size and cost (no API calls)
    python describe.py submit [--max N]   every piece not yet described and not already submitted (N requests max)
    python describe.py collect            fetch finished batches; merge results into captions/captions.json
    python describe.py status             batches submitted, their state, and what's left

Needs `pip install anthropic` and an API key (ANTHROPIC_API_KEY; plus ANTHROPIC_WORKSPACE_ID if the key isn't
scoped to a workspace). Each request sends one piece's male and female
sheets together (or one sheet when the piece exists on one body only), so the model can say how the two differ.
Replies are structured JSON; tags can only come from captions/TAGS.md. Submitted batches are recorded in
captions/batches.json, so this can be stopped and resumed; results stay downloadable for 29 days.
"""
import base64
import datetime
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import captions as C  # noqa: E402

MODEL = 'claude-sonnet-5-5'
STATE = os.path.join(HERE, 'captions', 'batches.json')
MAX_BATCH_BYTES = 200_000_000  # the API allows 256 MB per batch
MAX_BATCH_REQUESTS = 1500

INSTRUCTIONS = """You describe costume pieces from the game Champions Online, for an index that people and AI assistants search when designing costumes. You are shown rendered sheets of one piece: one sheet per body (male and/or female).

Each sheet has eight views of the piece on a plain grey mannequin, labelled in their corners:
- top row: the full body from the front; the piece zoomed from the front, three-quarter front and side;
- bottom row: the full body from the back; the piece zoomed from the back and three-quarter back; the piece alone from above.
In the zoomed views the body is drawn faded and the piece is drawn over it, so the piece shows from every side (even parts the body would hide). The piece uses its default material and a fixed test colour scheme: colour slot 0 light grey, slot 1 mid blue, slot 2 near black, slot 3 red. The mannequin's own grey tights, bare head and skin are not part of the piece.

For each body shown, write:
- description: one or two sentences, 15-40 words: what the piece is, its silhouette and construction details, where and how it sits on the body, and the style it suggests. Describe form only. Never name a colour from the sheet (grey, blue, black, red, pale, dark...): players recolour everything. Say "contrasting trim" or "a separate panel" instead. Don't guess at things you can't see; if a piece is tiny or unclear, say less.
- colourAreas: which visible features take which colour slot on this sheet, e.g. "Colour 0 on the coat; colour 1 on the lapels and cuffs; colour 3 on the buttons." Name slots by number, and name the feature rather than its test colour: write "colour 1 on one half of each bell", never "the blue halves", "the red markings" or "the dark patches". If the default material ignores the scheme (glossy metal, glass, glow), say so without naming the colour it shows.
- tags: 4-10 words from the allowed tag list that clearly apply (style, material look, form, features, coverage/length). Only tags you can see evidence for. Coverage and length tags are for garments and hair: sleeve tags (sleeveless, short-sleeved, long-sleeved) only for tops, suits and coats; length tags (waist-length to floor-length) only for how far a top, coat, cape, skirt or hair reaches. Small accessories (rings, pads, pouches, gauntlets, boots, badges) take "partial" at most.
- differs: only when both bodies are shown and the two versions differ in a way a player would notice when choosing: a different shape or extra part, a clearly different length or placement, or a different default colour pattern. Say how, in one sentence, from this body's point of view. Every piece is fitted to its body, so the male version is naturally broader and the female version slimmer and curvier: never mention that alone. Ignore differences in pose, angle or which way the piece faces on the sheet. Most pieces don't differ; then write an empty string, and give the same description, colourAreas and tags for both bodies.

The piece's name, slot and facts from the game data are given for context; trust the pictures over the name when they disagree.

Allowed tags, by group:
{tags}

Two examples of good entries (for other pieces):
{examples}"""


def load_state():
    try:
        return json.load(open(STATE, encoding='utf-8'))
    except (OSError, ValueError):
        return {'batches': []}


def save_state(state):
    json.dump(state, open(STATE, 'w', encoding='utf-8'), indent=1)


def tags_text():
    lines = open(os.path.join(HERE, 'captions', 'TAGS.md'), encoding='utf-8').read().splitlines()
    out, group = [], None
    for line in lines:
        if line.startswith('## ') and 'Entry format' not in line:
            group = line[3:]
        elif group and ' · ' in line:
            out.append(f'{group}: {line.strip()}')
    return '\n'.join(out)


def client_():
    """An API client; a key that isn't scoped to a workspace also needs ANTHROPIC_WORKSPACE_ID (the workspace to bill)."""
    import anthropic
    ws = os.environ.get('ANTHROPIC_WORKSPACE_ID')
    return anthropic.Anthropic(default_headers={'anthropic-workspace-id': ws} if ws else None, timeout=600, max_retries=5)


# two hand-written entries (checked against their sheets) shown to the model as examples: the male twin-lens goggles
# (M_Eye_Face_Robot_Monical_Dual_01) and the female Valflare top (F_Chest_Tight_Valflare_01)
EXAMPLES = r'''{"body": "Male", "description": "Mechanical twin-lens goggles: two short telescoping lens barrels on angular metal housings over the eyes, held by a thick padded strap that loops over the top of the head.", "colourAreas": "Colour 0 on the housings and barrels; colour 1 on the barrel rings; colour 3 on the lenses; colour 2 on the head strap.", "tags": ["steampunk", "sci-fi", "robotic", "metal", "angular", "goggles", "straps", "partial"], "differs": ""}
{"body": "Female", "description": "A long-sleeved, form-fitting superhero top with a glossy centre panel, flame-like swooping panels over the shoulders and ribs, a flared wing shape under the chest, and bands of piping down the arms; ends at the waist.", "colourAreas": "Colour 2 on the glossy centre and forearm panels; colour 3 on the shoulder and rib flames; colour 0 on the collar swirls, under-chest wings and upper arms; colour 1 on the side panels, sleeve bands and piping.", "tags": ["superhero", "latex", "form-fitting", "sleek", "zipper", "trim", "long-sleeved", "waist-length", "full-coverage"], "differs": "The female top adds a zip line down the centre of the chest and a narrower, corset-like waist."}'''


# test-scheme colour words that slip through as adjectives ("a dark plate", "red-edged trim", "a blue-toned patch"):
# dropped from colourAreas (the slot number says it), and made "contrasting" in descriptions
COLOURS = r'(?:dark|pale|red|blue|black|grey|gray|white|silvery)'
SHEET_COLOUR = re.compile(r'\b' + COLOURS + r'\s+(?=[a-z])', re.I)
SHEET_COLOUR_TONE = re.compile(r'\b' + COLOURS + r'-(?:style|toned|tinted|tinged|ish|coloured|dominant)\b', re.I)
SHEET_COLOUR_PREFIX = re.compile(r'\b' + COLOURS + r'-(?=[a-z])', re.I)


def uncolour(text, keep_word=True):
    text = SHEET_COLOUR_TONE.sub('contrasting' if keep_word else '', text)
    text = SHEET_COLOUR_PREFIX.sub('contrasting-' if keep_word else '', text)
    text = SHEET_COLOUR.sub('contrasting ' if keep_word else '', text)
    text = re.sub(r'\bcontrasting\s+contrasting\b', 'contrasting', text)
    return re.sub(r'  +', ' ', text).replace(' ,', ',').strip()


def schema():
    return {'type': 'object', 'additionalProperties': False, 'required': ['entries'], 'properties': {
        'entries': {'type': 'array', 'items': {
            'type': 'object', 'additionalProperties': False,
            'required': ['body', 'description', 'colourAreas', 'tags', 'differs'],
            'properties': {
                'body': {'type': 'string', 'enum': ['Male', 'Female']},
                'description': {'type': 'string'},
                'colourAreas': {'type': 'string'},
                'tags': {'type': 'array', 'items': {'type': 'string', 'enum': sorted(C.tag_list())}},
                'differs': {'type': 'string'}}}}}}


def pieces():
    """{'<Male|Female>/<geometry>': facts} for every indexed piece, from index/index.json."""
    out = {}
    for sk, data in C.index().items():
        for slot in data['slots'].values():
            for p in slot['pieces']:
                out[f'{sk}/{p["name"]}'] = {'displayName': p['displayName'], 'slot': slot['title'], 'categories': p['categories'],
                                            'cloth': p.get('cloth'), 'hair': p.get('hair'), 'children': len(p.get('children') or [])}
    return out


def groups(only=None):
    """Requests to make: [[key, ...]] with a piece's male and female versions together, for rendered sheets."""
    have = {f'{sk}/{n[:-4]}' for sk in ('Male', 'Female') if os.path.isdir(os.path.join(C.RENDERS, sk))
            for n in os.listdir(os.path.join(C.RENDERS, sk)) if n.endswith('.jpg')}
    keys = sorted(k for k in pieces() if k in have and (only is None or k in only))
    seen, out = set(), []
    for k in keys:
        if k in seen:
            continue
        sk, geo = k.split('/', 1)
        other = ('Female' if sk == 'Male' else 'Male') + '/' + C.counterpart(geo)
        group = [k] + ([other] if other in keys and other not in seen and other != k else [])
        seen.update(group)
        out.append(group)
    return out


def request_for(cid, group, facts, system):
    content = []
    for key in group:
        sk, geo = key.split('/', 1)
        f = facts[key]
        info = {'body': sk, 'piece': geo, 'name': f['displayName'], 'slot': f['slot'], 'categories': f['categories']}
        if f.get('cloth'):
            info['cloth'] = 'yes (simulated cloth, shown settled)'
        if f.get('hair'):
            info['hairLength'] = f['hair']
        content.append({'type': 'text', 'text': f'{sk} sheet. Facts: ' + json.dumps(info, ensure_ascii=False)})
        data = open(os.path.join(C.RENDERS, sk, geo + '.jpg'), 'rb').read()
        content.append({'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/jpeg',
                                                    'data': base64.standard_b64encode(data).decode('ascii')}})
    content.append({'type': 'text', 'text': 'Write one entry per body shown (' + ', '.join(k.split('/')[0] for k in group) + ').'})
    return {'custom_id': cid, 'params': {
        'model': MODEL, 'max_tokens': 4000, 'system': system,
        'output_config': {'effort': 'low', 'format': {'type': 'json_schema', 'schema': schema()}},
        'messages': [{'role': 'user', 'content': content}]}}


def pending_keys(state):
    return {k for b in state['batches'] if not b.get('collected') for ks in b['requests'].values() for k in ks}


def plan():
    caps, state = C.load_captions(), load_state()
    todo = [g for g in groups() if not all(k in caps for k in g)]
    todo = [g for g in todo if not (set(g) & pending_keys(state))]
    sheets = sum(len(g) for g in todo)
    size = sum(os.path.getsize(os.path.join(C.RENDERS, *k.split('/', 1)) + '.jpg') * 4 / 3 for g in todo for k in g)
    # rough tokens: ~1,100 per sheet, ~2,000 shared instructions (cached after the first requests), ~250 out per sheet
    inp, out = sheets * 1100 + len(todo) * 300, sheets * 250 + len(todo) * 150
    cost = (inp * 2 + out * 10) / 1e6 / 2 + len(todo) * 2000 * 0.2 / 1e6 / 2
    print(f'{len(todo)} requests covering {sheets} sheets; about {size / 1e6:.0f} MB of images, '
          f'so {max(1, -(-int(size) // MAX_BATCH_BYTES))} or more batches; rough cost ${cost:.0f} at batch prices')
    return todo


def submit(max_requests=None):
    import anthropic
    todo = plan()
    if max_requests:
        todo = todo[:max_requests]
    if not todo:
        print('nothing to submit')
        return
    client, state, facts = client_(), load_state(), pieces()
    system = [{'type': 'text', 'text': INSTRUCTIONS.format(tags=tags_text(), examples=EXAMPLES),
               'cache_control': {'type': 'ephemeral'}}]
    n0 = sum(len(b['requests']) for b in state['batches'])
    batch, size, mapping = [], 0, {}

    def send():
        nonlocal batch, size, mapping
        if not batch:
            return
        b = client.messages.batches.create(requests=batch)
        state['batches'].append({'id': b.id, 'kind': 'all', 'model': MODEL,
                                 'submitted': datetime.datetime.now().isoformat(timespec='seconds'),
                                 'requests': mapping, 'collected': False})
        save_state(state)
        print(f'submitted {b.id}: {len(batch)} requests, {size / 1e6:.0f} MB')
        batch, size, mapping = [], 0, {}

    for i, group in enumerate(todo):
        cid = f'r{n0 + i:06d}'
        req = request_for(cid, group, facts, system)
        req_size = len(json.dumps(req))
        if batch and (size + req_size > MAX_BATCH_BYTES or len(batch) >= MAX_BATCH_REQUESTS):
            send()
        batch.append(req)
        mapping[cid] = group
        size += req_size
    send()


def collect():
    client, state = client_(), load_state()
    caps = C.load_captions()
    allowed = C.tag_list()
    usage = {'input': 0, 'output': 0, 'cache_read': 0, 'cache_write': 0}
    cats = {}

    def save():
        # the mesh and model each description is for (build_index.py only uses one that still matches the piece)
        for key, e in caps.items():
            if 'mesh' not in e:
                sk, geo = key.split('/', 1)
                if sk not in cats:
                    cats[sk] = C.catalog(sk)['geometries']
                g = cats[sk].get(geo) or {}
                e['mesh'], e['model'] = g.get('mesh'), g.get('model')
        json.dump(dict(sorted(caps.items())), open(C.CAPTIONS, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
        save_state(state)

    for b in state['batches']:
        if b.get('collected') or b['kind'] == 'pilot':
            continue
        info = client.messages.batches.retrieve(b['id'])
        if info.processing_status != 'ended':
            c = info.request_counts
            print(f'{b["id"]}: {info.processing_status} ({c.succeeded} done, {c.processing} processing)', flush=True)
            continue
        print(f'{b["id"]}: downloading results...', flush=True)
        failed, added, got = [], 0, 0
        for r in client.messages.batches.results(b['id']):
            got += 1
            if got % 250 == 0:
                print(f'  {got} results read', flush=True)
            group = b['requests'].get(r.custom_id, [])
            if r.result.type != 'succeeded':
                failed.append((r.custom_id, r.result.type))
                continue
            msg = r.result.message
            u = msg.usage
            usage['input'] += u.input_tokens
            usage['output'] += u.output_tokens
            usage['cache_read'] += u.cache_read_input_tokens or 0
            usage['cache_write'] += u.cache_creation_input_tokens or 0
            if msg.stop_reason != 'end_turn':
                failed.append((r.custom_id, msg.stop_reason))
                continue
            try:
                entries = json.loads(next(x.text for x in msg.content if x.type == 'text'))['entries']
            except (StopIteration, ValueError, KeyError):
                failed.append((r.custom_id, 'unreadable reply'))
                continue
            for key in group:
                e = next((x for x in entries if x['body'] == key.split('/')[0]), None)
                if not e or not e['description'].strip():
                    failed.append((r.custom_id, f'no entry for {key}'))
                    continue
                caps[key] = {'description': uncolour(e['description']), 'colourAreas': uncolour(e['colourAreas'], False),
                               'tags': [t for t in dict.fromkeys(e['tags']) if t in allowed],
                               **({'differs': uncolour(e['differs'])} if e['differs'].strip() and len(group) > 1 else {}),
                               'from': MODEL + ' batch', 'date': datetime.date.today().isoformat()}
                added += 1
        b['collected'] = True
        b['failed'] = failed
        save()  # after every batch, so an interrupted collect keeps what it has
        print(f'{b["id"]} ({b["kind"]}): {added} descriptions, {len(failed)} failed' + (f', e.g. {failed[:3]}' if failed else ''), flush=True)
    save()
    cost = (usage['input'] * 2 + usage['output'] * 10 + usage['cache_read'] * 0.2 + usage['cache_write'] * 2.5) / 1e6 / 2
    if any(usage.values()):
        print(f'tokens: {usage}; about ${cost:.2f} at batch prices')


def status():
    state, caps = load_state(), C.load_captions()
    for b in state['batches']:
        print(f'{b["id"]} {b["kind"]:5} {b["submitted"]}  {len(b["requests"])} requests  '
              + ('collected' + (f', {len(b.get("failed", []))} failed' if b.get('failed') else '') if b.get('collected') else 'waiting'))
    left = [g for g in groups() if not all(k in caps for k in g)]
    waiting = pending_keys(state)
    print(f'{len(caps)} descriptions; {len(left)} requests still to describe, '
          f'{sum(1 for g in left if not set(g) & waiting)} of them not yet submitted')


if __name__ == '__main__':
    args = sys.argv[1:]
    cmd = args[0] if args else ''
    if cmd == 'plan':
        plan()
    elif cmd == 'submit':
        submit(int(args[args.index('--max') + 1]) if '--max' in args else None)
    elif cmd == 'collect':
        collect()
    elif cmd == 'status':
        status()
    else:
        print(__doc__)
        sys.exit(2)
