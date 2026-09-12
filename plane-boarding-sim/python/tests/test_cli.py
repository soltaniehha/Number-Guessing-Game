"""CLI presentation logic. Small, but it is what a reader actually sees."""

from __future__ import annotations

from plane_boarding.cli import build_parser, shared_ranks


def test_clearly_separated_results_get_distinct_ranks():
    assert shared_ranks([10, 20, 30], [0.1, 0.1, 0.1]) == [1, 2, 3]


def test_overlapping_intervals_share_a_rank():
    assert shared_ranks([10, 10.5, 11], [5, 5, 5]) == [1, 1, 1]


def test_ranks_are_competition_style_and_skip_after_a_tie():
    #   10 & 11 tie for 1st, 20 & 21 tie for 3rd, 22 is 5th, 40 is 6th
    assert shared_ranks([10, 11, 20, 21, 22, 40], [0.6] * 6) == [1, 1, 3, 3, 5, 6]


def test_overlap_does_not_chain_transitively():
    """10 overlaps 11 and 11 overlaps 12, but 10 does not overlap 12. Chaining
    'overlaps its neighbour' would merge the whole table into one tie, so
    overlap is tested against the group leader instead."""
    assert shared_ranks([10, 11, 12], [0.6, 0.6, 0.6]) == [1, 1, 3]


def test_degenerate_inputs():
    assert shared_ranks([], []) == []
    assert shared_ranks([10], [1]) == [1]
    assert shared_ranks([10, 10], [0.0, 0.0]) == [1, 1]


def test_a_tie_is_never_reported_as_a_win():
    """The property that matters: if the top two overlap, rank 1 is shared and
    the summary line must not name a single winner."""
    ranks = shared_ranks([100.0, 100.4], [1.0, 1.0])
    assert ranks[0] == ranks[1] == 1
    assert len([r for r in ranks if r == ranks[0]]) > 1


def test_parser_accepts_every_documented_subcommand():
    p = build_parser()
    for argv in (["run", "-a", "e175"], ["compare", "-n", "3"],
                 ["sweep", "-f", "0.5", "1.0"], ["export", "--geometry"]):
        assert p.parse_args(argv).command == argv[0]
