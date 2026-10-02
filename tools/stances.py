"""Resolve a costume stance to the animations the game plays for it.

Chain (all from decoded bins):
  PCSkeletonDef.Stance[].Bits + mode bits ('Costume' in the character creator, 'Idle' in the world)
  SkelInfo.BlendInfo -> SkelBlendInfo: a main 'Default' sequencer (whole body) plus sub-sequencers
      that own specific bones (Core_Blend_Lowerbody, Core_Face, ...)
  Each sequencer's sequences live in Dyn/Sequence/<sequencer>/ (the main one: Dyn/Sequence/*.Dseq)
    -> DynSeqData whose requiresBits are all active (highest Priority, then most bits)
    -> action whose FirstIf holds (else the first unconditional one) -> DynMove whose UseIf holds
    -> DynMove.DynMoveSeq variant for the skeleton's SkelInfo.SeqType (in order)
    -> DynAnimTrack.AnimTrackName  (animation_library/<name>.atrk)
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
import gamedata  # noqa: E402  (decoded bins from the install's archives)
# The character stands still in both: 'Idle' is set in the creator too (it only adds the empty
# basebone idle on the body, but tails and wings have no creator-specific idle, only 'Idle' ones).
# 'Costume' is the creator's costume-pose bit (CharacterCreation_ForceCostumeStance): its Stance & Mood
# screen clears it, so moods (which only drive the in-world face and tail sequences) show in 'idle'.
MODES = {'creator': ('Costume', 'Idle'), 'idle': ('Idle',)}


def mood_bits():
    """Costumemood name -> animation bits ('Normal' has none)."""
    moods = _load('Costumemood')
    return {m['Name']: m['Bits'].split() for m in sorted(moods, key=lambda m: m['Order'])}


def _load(name):
    return gamedata.records(name)


def _bits(v):
    return {b.lower() for b in v['ppcBits']}


class StanceResolver:
    def __init__(self):
        self.seqs = _load('DynSequences')
        self.moves = {m['Name'].lower(): m for m in _load('DynMove')}
        self.skelinfos = {s['Name'].lower(): s for s in _load('SkelInfos')}
        self.blendinfos = {b['BlendInfoName'].lower(): b for b in _load('BlendInfos')}
        self.skeldefs = {s['Name']: s for s in json.load(
            open(os.path.join(HERE, '..', 'catalog', 'skeletons.json'), encoding='utf-8'))}

    @staticmethod
    def _sequencer_of(seq):
        parts = seq['FileName'].split('/')
        return parts[2] if len(parts) > 3 else 'Default'

    @staticmethod
    def _matches(cond, active):
        return _bits(cond['on']) <= active and not (_bits(cond['off']) & active)

    def sequence(self, active, sequencer):
        best = None
        for s in self.seqs:
            if self._sequencer_of(s).lower() != sequencer.lower():
                continue
            req = _bits(s['requiresBits'])
            if not req or not req <= active:
                continue
            key = (s['Priority'], len(req))
            if best is None or key > best[0]:
                best = (key, s)
        return best[1] if best else None

    def _action(self, seq, active):
        for a in seq['DynAction']:
            if a['FirstIf'] and any(self._matches(c, active) for c in a['FirstIf']):
                return a
        return next((a for a in seq['DynAction'] if not a['FirstIf']), seq['DynAction'][0])

    def _track(self, move_name, seqtypes):
        move = self.moves.get(move_name.lower())
        if not move:
            return None
        variants = {ms['DynMoveSeq'].lower(): ms for ms in move['DynMoveSeq'] if ms['DynAnimTrack']}
        for t in seqtypes:
            if t.lower() in variants:
                return variants[t.lower()]['DynAnimTrack']['AnimTrackName']
        return None

    def resolve_sub(self, skelinfo, skeleton, stance, mode='creator', extra=()):
        """Track a sub-skeleton (tail, wings: SkelInfo with its own Sequencer) plays for a stance."""
        info = self.skelinfos.get(skelinfo.lower())
        sdef = self.skeldefs[skeleton]
        st = next((x for x in sdef['Stance'] if x['Name'].lower() == (stance or '').lower()), None)
        if not info or not info.get('Sequencer') or st is None:
            return None
        active = {b.lower() for b in st['Bits'].split() + list(MODES[mode]) + list(extra)}
        seq = self.sequence(active, info['Sequencer'])
        if not seq or not seq['DynAction']:
            return None
        action = self._action(seq, active)
        move = next((m['hMove'] for m in action['DynMove'] if self._matches(m['UseIf'], active)), None)
        return self._track(move, info['SeqType']) if move else None

    def resolve(self, skeleton, stance, mode='creator', extra=()):
        """-> {'stance', 'bits', 'sequencers': [{'sequencer', 'bones', 'sequence', 'move', 'track'}]}"""
        sdef = self.skeldefs[skeleton]
        stance = stance or sdef['DefaultStance']
        st = next((x for x in sdef['Stance'] if x['Name'].lower() == stance.lower()), None)
        if st is None:
            return None
        bits = st['Bits'].split() + list(MODES[mode]) + list(extra)
        active = {b.lower() for b in bits}
        info = self.skelinfos[sdef['Skeleton'].lower()]
        blend = self.blendinfos[info['BlendInfo'].lower()]
        out = []
        sequencers = [('Default', [])] + [(x['SeqName'], x['Bone']) for x in blend['Sequencer'] if not x['Overlay']]
        for name, bones in sequencers:
            seq = self.sequence(active, name)
            entry = {'sequencer': name, 'bones': bones, 'sequence': seq and seq['Name']}
            if seq and seq['DynAction']:
                action = self._action(seq, active)
                move = next((m['hMove'] for m in action['DynMove'] if self._matches(m['UseIf'], active)), None)
                entry.update(action=action['Name'], move=move,
                             track=self._track(move, info['SeqType']) if move else None)
            out.append(entry)
        return {'stance': st['Name'], 'bits': bits, 'sequencers': out}


if __name__ == '__main__':
    r = StanceResolver()
    for mode in MODES:
        print('== mode', mode)
        for skel in ('Male', 'Female'):
            for st in r.skeldefs[skel]['Stance']:
                if st['RestrictedTo'] & 8:  # player-selectable at creation
                    x = r.resolve(skel, st['Name'], mode)
                    print(f"  {skel:6} {x['stance']:14}", ' | '.join(
                        f"{e['sequencer'][:14]}: {e.get('track')}" for e in x['sequencers']))
