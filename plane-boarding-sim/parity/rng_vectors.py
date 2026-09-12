import json, sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'python'))
from plane_boarding.rng import PCG32
out = {}
r = PCG32(42, 1); out['u32'] = [r.next_uint32() for _ in range(12)]
r = PCG32(42, 1); out['random'] = [round(r.random(), 15) for _ in range(6)]
r = PCG32(7, 2);  out['randint7'] = [r.randint(7) for _ in range(20)]
r = PCG32(7, 2);  out['randint1000'] = [r.randint(1000) for _ in range(10)]
r = PCG32(99, 3); out['normal'] = [round(r.normal(10, 3), 12) for _ in range(8)]
r = PCG32(99, 3); out['lognormal'] = [round(r.lognormal(12.5, 6.0), 12) for _ in range(8)]
r = PCG32(5, 1);  out['truncnormal'] = [round(r.truncnormal(1.0, 0.4, 0.35, 3.0), 12) for _ in range(8)]
r = PCG32(3, 1);  out['shuffle'] = r.shuffle(list(range(15)))
r = PCG32(3, 1);  out['bernoulli'] = [r.bernoulli(0.3) for _ in range(20)]
r = PCG32(11, 2); out['weighted'] = [r.weighted_pick(['a','b','c'], [0.2, 0.5, 0.3]) for _ in range(20)]
r = PCG32(21, 3); out['exponential'] = [round(r.exponential(3.7), 12) for _ in range(10)]
r = PCG32(22, 3); out['weibull'] = [round(r.weibull(1.7, 16.0), 12) for _ in range(10)]
r = PCG32(23, 3); out['triangular'] = [round(r.triangular(1.8, 2.4, 3.0), 12) for _ in range(10)]
r = PCG32(24, 1); out['mixed'] = [round(r.exponential(3.7), 12), round(r.weibull(1.7, 16.0), 12), round(r.triangular(1.8, 2.4, 3.0), 12), round(r.normal(0, 1), 12), round(r.triangular(0.0, 0.0, 1.0), 12), round(r.triangular(0.0, 1.0, 1.0), 12)]
r = PCG32(2**63 + 12345, 9); out['bigseed'] = [r.next_uint32() for _ in range(5)]
print(json.dumps(out))
