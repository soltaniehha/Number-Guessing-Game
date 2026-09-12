"""Deterministic PCG32 random number generator.

This module is the keystone of cross-language parity: `web/src/sim/rng.js` is a
line-for-line mirror of this file. Any change here MUST be mirrored there, and
`parity/` will fail loudly if the two ever drift.

See docs/ENGINE_SPEC.md section 1 for the normative definition.
"""

import math

UINT64_MASK = (1 << 64) - 1
UINT32_MASK = (1 << 32) - 1
PCG_MULT = 6364136223846793005
TWO_POW_32 = 4294967296.0
TWO_POW_32_INT = 1 << 32


class PCG32:
    """PCG32 XSH-RR. 64-bit state, 64-bit stream selector."""

    __slots__ = ("state", "inc")

    def __init__(self, seed: int, stream: int = 1):
        self.state = 0
        self.inc = ((int(stream) << 1) | 1) & UINT64_MASK
        self.next_uint32()
        self.state = (self.state + (int(seed) & UINT64_MASK)) & UINT64_MASK
        self.next_uint32()

    # -- core ---------------------------------------------------------------

    def next_uint32(self) -> int:
        old = self.state
        self.state = (old * PCG_MULT + self.inc) & UINT64_MASK
        xorshifted = (((old >> 18) ^ old) >> 27) & UINT32_MASK
        rot = (old >> 59) & 31
        return ((xorshifted >> rot) | (xorshifted << ((-rot) & 31))) & UINT32_MASK

    # -- derived distributions ---------------------------------------------

    def random(self) -> float:
        """Float in [0, 1)."""
        return self.next_uint32() / TWO_POW_32

    def uniform(self, a: float, b: float) -> float:
        return a + (b - a) * self.random()

    def randint(self, n: int) -> int:
        """Integer in [0, n), rejection-sampled to remove modulo bias."""
        if n <= 0:
            return 0
        limit = TWO_POW_32_INT - (TWO_POW_32_INT % n)
        while True:
            r = self.next_uint32()
            if r < limit:
                return r % n

    def normal(self, mu: float = 0.0, sigma: float = 1.0) -> float:
        """Box-Muller. Deliberately does NOT cache the second variate, so the
        number of draws consumed per call is always exactly two."""
        u1 = self.random()
        if u1 < 1e-12:
            u1 = 1e-12
        u2 = self.random()
        z = math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)
        return mu + sigma * z

    def truncnormal(self, mu: float, sigma: float, lo: float, hi: float) -> float:
        value = mu
        for _ in range(32):
            value = self.normal(mu, sigma)
            if lo <= value <= hi:
                return value
        return min(hi, max(lo, value))

    def lognormal(self, mean: float, sd: float) -> float:
        """Parameterised by the mean/sd of the RESULT, not of the underlying
        normal -- this is what makes the config parameters human-readable."""
        if mean <= 0:
            return 0.0
        if sd <= 0:
            return mean
        var = sd * sd
        mu = math.log(mean * mean / math.sqrt(var + mean * mean))
        sigma = math.sqrt(math.log(1.0 + var / (mean * mean)))
        return math.exp(self.normal(mu, sigma))

    def bernoulli(self, p: float) -> bool:
        return self.random() < p

    def shuffle(self, items: list) -> list:
        """In-place Fisher-Yates, descending index. Returns the same list."""
        for i in range(len(items) - 1, 0, -1):
            j = self.randint(i + 1)
            items[i], items[j] = items[j], items[i]
        return items

    def choice(self, items: list):
        return items[self.randint(len(items))]

    def weighted_pick(self, keys: list, weights: list):
        """One draw. `keys` and `weights` must be parallel and ordered
        deterministically by the caller."""
        total = 0.0
        for w in weights:
            total += max(0.0, w)
        if total <= 0:
            return keys[0]
        r = self.random() * total
        acc = 0.0
        for i, w in enumerate(weights):
            acc += max(0.0, w)
            if r < acc:
                return keys[i]
        return keys[-1]
