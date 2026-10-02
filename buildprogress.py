"""How far the editor's data build has got, for the progress bar on the page: build.py splits the bar between
its stages, a stage can split its share further (span), and loops report within the current share (report).
Each report prints '%% <fraction of the whole build>'; serve.py reads those lines from the build's output.
Loops report unevenly (one big file, then many small ones), so build.py also runs a clock per stage (timed):
the bar moves with the time the stage is expected to take, stopping just short of its end, and whichever of the
two is further ahead is shown. The bar never goes back.
Run on its own, a stage just prints a few extra lines.
"""
import threading
import time
from contextlib import contextmanager

_stack = [(0.0, 1.0)]  # the current share of the bar
_last = [-1.0]         # the furthest point printed
_lock = threading.Lock()


def _emit(f, force=False):
    with _lock:
        if f - _last[0] >= 0.002 or (force and f > _last[0]):  # forward only, at most every 0.2 %
            _last[0] = f
            print(f'%% {f:.4f}', flush=True)


def report(done, total):
    """done of total steps of the current share are finished."""
    lo, hi = _stack[-1]
    f = lo + (hi - lo) * min(1.0, max(0.0, done / total if total else 1.0))
    _emit(f, force=f in (lo, hi))


@contextmanager
def timed(seconds):
    """While the block runs, move through the current share with the clock, as if it takes this long
    (to 95 % of the share; reports from the block can get ahead)."""
    lo, hi = _stack[-1]
    stop, t0 = threading.Event(), time.time()

    def tick():
        while not stop.wait(0.25):
            _emit(lo + (hi - lo) * min(0.95, (time.time() - t0) / max(seconds, 0.1)))
    t = threading.Thread(target=tick, daemon=True)
    t.start()
    try:
        yield
    finally:
        stop.set()
        t.join()


@contextmanager
def span(a, b):
    """The part from a to b (fractions of the current share), e.g. one of two skeletons: with span(0, 0.5)."""
    lo, hi = _stack[-1]
    _stack.append((lo + (hi - lo) * a, lo + (hi - lo) * b))
    report(0, 1)
    try:
        yield
    finally:
        report(1, 1)
        _stack.pop()


def each(items, a=0.0, b=1.0):
    """Loop over items within the part from a to b of the current share, each item getting an equal slice of
    it (so reports from a loop inside the item move through that item's slice)."""
    items = list(items)
    n = max(1, len(items))
    with span(a, b):
        for i, x in enumerate(items):
            with span(i / n, (i + 1) / n):
                yield x
