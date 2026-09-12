"""The replay document the web visualiser consumes."""

from __future__ import annotations

import json

import pytest

from plane_boarding.aircraft import get_aircraft
from plane_boarding.config import QUEUED, SEATED
from plane_boarding.engine import run

from helpers import cfg_for


@pytest.fixture(scope="module")
def replay():
    cfg = cfg_for("a220_300", "common_sense_5tier", seed=6, loadFactor=0.8)
    result, rep = run(cfg, record_replay=True)
    return cfg, result, rep


def test_replay_has_the_documented_shape(replay):
    cfg, result, rep = replay
    assert set(rep) >= {"aircraft", "config", "strategy", "seed", "frameInterval",
                        "frameCount", "duration", "passengers", "frames", "result"}
    assert rep["strategy"] == cfg.strategy
    assert rep["seed"] == cfg.seed
    assert rep["frameInterval"] == 0.25
    # `duration` is the SPAN OF THE FRAME BUFFER, not the boarding time: the run
    # ends mid-interval, and the terminal frame sits at the next grid point. It
    # must therefore be >= totalSeconds and within one frame interval of it, so
    # a scrubber driven by it can actually reach the last frame.
    assert rep["duration"] >= result.totalSeconds
    assert rep["duration"] - result.totalSeconds < rep["frameInterval"] + 1e-9
    assert rep["duration"] == rep["frameInterval"] * (rep["frameCount"] - 1)


@pytest.mark.parametrize("aid", ["e175", "a320neo", "b737_max8", "a220_300",
                                 "b777_300er", "b787_9"])
def test_the_last_reachable_frame_agrees_with_the_result(aid):
    """The frame buffer and the RunResult must not contradict each other.

    They did: `duration` was `totalSeconds`, which lands one grid step short of
    the terminal frame, so on a220_300, b777_300er and b787_9 the far right of
    the timeline showed a passenger still shuffling while the status bar said
    all N were seated. Asserts both halves -- the terminal frame is terminal,
    and a renderer stepping to `duration` actually reaches it.
    """
    cfg = cfg_for(aid, "random", seed=1)
    result, rep = run(cfg, record_replay=True)
    assert result.completed
    assert all(s == SEATED for s in rep["frames"]["state"][-1]), (
        f"{aid}: the closing frame is not the terminal state")
    # What the renderer does: index = clamp(floor(t / frameInterval), 0, last).
    last = rep["frameCount"] - 1
    idx = min(last, int(rep["duration"] / rep["frameInterval"] + 1e-9))
    assert idx == last, (
        f"{aid}: the scrubber's right edge reaches frame {idx} of {last}, so the "
        f"terminal frame is unreachable")


def test_frame_arrays_are_rectangular_and_indexed_by_passenger(replay):
    _, result, rep = replay
    n = len(rep["passengers"])
    assert n == result.paxCount
    assert rep["frameCount"] == len(rep["frames"]["state"]) == len(rep["frames"]["x"])
    for st, xs in zip(rep["frames"]["state"], rep["frames"]["x"]):
        assert len(st) == n and len(xs) == n
        assert all(0 <= s <= 4 for s in st)


def test_frames_span_the_whole_boarding(replay):
    _, result, rep = replay
    assert set(rep["frames"]["state"][0]) <= {QUEUED, 1}
    assert set(rep["frames"]["state"][-1]) == {SEATED}
    expected = int(result.totalSeconds / rep["frameInterval"]) + 1
    assert abs(rep["frameCount"] - expected) <= 2


def test_passenger_records_carry_what_the_renderer_needs(replay):
    cfg, _, rep = replay
    sizes = dict(zip(cfg.partyKeys, cfg.partyWeights))  # noqa: F841  (shape only)
    for p in rep["passengers"]:
        assert set(p) == {"id", "seatRow", "seatLetter", "seatX", "seatDepth", "lane",
                          "cabinId", "tier", "groupLabel", "bags", "partyId",
                          "partySize", "party", "doorId"}
        assert p["seatRow"] is not None and p["doorId"]


def test_party_id_and_party_size_are_not_the_same_field(replay):
    """They were: the payload emitted the party INDEX under the name `party`,
    and the cabin renderer prints that as a size -- so a tooltip read
    "44 together" on an aircraft whose party sizes stop at 5."""
    cfg, _, rep = replay
    biggest = max(cfg.partyKeys)
    counts: dict = {}
    for p in rep["passengers"]:
        counts[p["partyId"]] = counts.get(p["partyId"], 0) + 1
    for p in rep["passengers"]:
        assert 1 <= p["partySize"] <= biggest, (
            f"partySize {p['partySize']} is outside the configured range 1..{biggest}")
        assert p["partySize"] == counts[p["partyId"]], (
            "partySize must equal how many people actually share that partyId")
        assert p["party"] == p["partySize"], "the deprecated alias carries the SIZE"
    assert max(p["partyId"] for p in rep["passengers"]) > biggest, (
        "this aircraft must have more parties than the largest party size, or the "
        "test cannot tell the two fields apart")


def test_replay_round_trips_through_json(replay):
    _, _, rep = replay
    assert json.loads(json.dumps(rep))["frameCount"] == rep["frameCount"]


def test_open_seating_replay_reports_the_seat_actually_taken():
    cfg = cfg_for("e175", "open_seating", seed=3)
    result, rep = run(cfg, record_replay=True)
    ac = get_aircraft("e175")
    valid = {(s.rowNumber, s.letter) for s in ac.seats}
    taken = [(p["seatRow"], p["seatLetter"]) for p in rep["passengers"]]
    assert len(set(taken)) == len(taken)
    assert set(taken) <= valid
