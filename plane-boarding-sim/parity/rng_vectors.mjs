import { PCG32 } from '../web/src/sim/rng.js'
const round = (x, n) => { const f = 10 ** n; return Math.round(x * f) / f }
const out = {}
let r = new PCG32(42, 1); out.u32 = Array.from({length:12}, () => r.nextUint32())
r = new PCG32(42, 1); out.random = Array.from({length:6}, () => round(r.random(), 15))
r = new PCG32(7, 2);  out.randint7 = Array.from({length:20}, () => r.randint(7))
r = new PCG32(7, 2);  out.randint1000 = Array.from({length:10}, () => r.randint(1000))
r = new PCG32(99, 3); out.normal = Array.from({length:8}, () => round(r.normal(10, 3), 12))
r = new PCG32(99, 3); out.lognormal = Array.from({length:8}, () => round(r.lognormal(12.5, 6.0), 12))
r = new PCG32(5, 1);  out.truncnormal = Array.from({length:8}, () => round(r.truncnormal(1.0, 0.4, 0.35, 3.0), 12))
r = new PCG32(3, 1);  out.shuffle = r.shuffle([...Array(15).keys()])
r = new PCG32(3, 1);  out.bernoulli = Array.from({length:20}, () => r.bernoulli(0.3))
r = new PCG32(11, 2); out.weighted = Array.from({length:20}, () => r.weightedPick(['a','b','c'], [0.2, 0.5, 0.3]))
r = new PCG32(21, 3); out.exponential = Array.from({length:10}, () => round(r.exponential(3.7), 12))
r = new PCG32(22, 3); out.weibull = Array.from({length:10}, () => round(r.weibull(1.7, 16.0), 12))
r = new PCG32(23, 3); out.triangular = Array.from({length:10}, () => round(r.triangular(1.8, 2.4, 3.0), 12))
r = new PCG32(23, 3); out.triangular_degenerate = [round(r.triangular(0.0, 0.0, 1.0), 12), round(r.triangular(0.0, 1.0, 1.0), 12), round(r.triangular(2.0, 2.0, 2.0), 12), round(r.exponential(0.0), 12), round(r.weibull(1.7, 0.0), 12)]
// ADVERSARIAL INTERLEAVE. A block of 20 weibulls in a row would still pass even if
// weibull consumed two uint32s in one language and one in the other -- the draw
// counts only ever disagree visibly when calls of DIFFERENT arity are interleaved.
// So this sequence alternates one-draw (random/randint/bernoulli/exponential/
// weibull/triangular), two-draw (normal/lognormal), variable-draw (truncnormal,
// randint rejection) and many-draw (shuffle) calls in an irregular pattern.
const MIXED_OPS = ['normal','weibull','triangular','exponential','randint','random','weibull','normal',
                   'triangular','shuffle','exponential','truncnormal','weibull','randint','triangular',
                   'lognormal','exponential','normal','weibull','triangular','bernoulli','exponential',
                   'randint','weibull','normal','triangular','exponential','shuffle','weibull','random',
                   'triangular','truncnormal','exponential','normal','weibull','randint','triangular',
                   'lognormal','exponential','weibull','normal','triangular','bernoulli','exponential',
                   'weibull','triangular','randint','normal']
r = new PCG32(24, 1)
const mixed = []
for (const op of MIXED_OPS) {
  if (op === 'normal') mixed.push(round(r.normal(0.0, 1.0), 12))
  else if (op === 'lognormal') mixed.push(round(r.lognormal(12.5, 6.0), 12))
  else if (op === 'truncnormal') mixed.push(round(r.truncnormal(1.0, 0.4, 0.35, 3.0), 12))
  else if (op === 'weibull') mixed.push(round(r.weibull(1.7, 16.0), 12))
  else if (op === 'triangular') mixed.push(round(r.triangular(1.8, 2.4, 3.0), 12))
  else if (op === 'exponential') mixed.push(round(r.exponential(3.7), 12))
  else if (op === 'random') mixed.push(round(r.random(), 12))
  else if (op === 'randint') mixed.push(r.randint(7))
  else if (op === 'bernoulli') mixed.push(r.bernoulli(0.3))
  else if (op === 'shuffle') mixed.push(r.shuffle([...Array(5).keys()]))
}
out.mixed = mixed
out.mixed_tail = Array.from({length:4}, () => r.nextUint32())
r = new PCG32(2n**63n + 12345n, 9); out.bigseed = Array.from({length:5}, () => r.nextUint32())
console.log(JSON.stringify(out))
