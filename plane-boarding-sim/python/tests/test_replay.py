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
    assert rep["duration"] == result.totalSeconds


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
    _, _, rep = replay
    for p in rep["passengers"]:
        assert set(p) == {"id", "seatRow", "seatLetter", "seatX", "seatDepth", "lane",
                          "cabinId", "tier", "groupLabel", "bags", "party", "doorId"}
        assert p["seatRow"] is not None and p["doorId"]


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
