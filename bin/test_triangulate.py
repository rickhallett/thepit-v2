#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6.0", "pytest>=8.0"]
# ///
"""Tests for bin/triangulate — Darkcat Alley triangulation tool.

Co-located with the script it tests per project convention.
Documents 8 known bugs found by cross-model triangulation.

Backrefs: SD-318 (Darkcat Alley), SD-317 (QA sequencing)
"""

import importlib.util
import importlib.machinery
import io
import textwrap
from pathlib import Path

import pytest
import yaml


# ── Module Loading ─────────────────────────────────────────────


def load_triangulate():
    filepath = str(Path(__file__).parent / "triangulate")
    loader = importlib.machinery.SourceFileLoader("triangulate", filepath)
    spec = importlib.util.spec_from_loader("triangulate", loader, origin=filepath)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


tri = load_triangulate()


# ── Fixtures ───────────────────────────────────────────────────


def _make_finding(**overrides):
    """Create a valid finding dict with sensible defaults."""
    base = {
        "id": "F-001",
        "branch": "main",
        "file": "lib/bouts/engine.ts",
        "line": 42,
        "severity": "high",
        "watchdog": "WD-SH",
        "slopodar": "none",
        "title": "Missing null check in bout resolution",
        "description": "The bout resolution function does not check for null.",
        "recommendation": "Add null check before accessing properties.",
    }
    base.update(overrides)
    return base


def _make_review_yaml(
    findings, model="claude", date="2026-03-08", base_commit="abc123"
):
    """Build a markdown document containing a fenced YAML block with findings."""
    data = {
        "review": {
            "model": model,
            "date": date,
            "branches": ["main"],
            "base_commit": base_commit,
        },
        "findings": findings,
    }
    yaml_str = yaml.dump(data, default_flow_style=False, sort_keys=False)
    return f"# Review\n\nSome prose.\n\n```yaml\n{yaml_str}```\n\nMore prose.\n"


def _make_reviews_data(review_ids, models=None):
    """Build reviews_data dict for compute_metrics."""
    if models is None:
        models = [f"model-{rid}" for rid in review_ids]
    data = {}
    for rid, model in zip(review_ids, models):
        data[rid] = {
            "review": {"model": model, "date": "2026-03-08"},
            "findings": [],
        }
    return data


# ═══════════════════════════════════════════════════════════════
# 1. YAML Extraction — extract_yaml_block
# ═══════════════════════════════════════════════════════════════


class TestExtractYamlBlock:
    def test_valid_fenced_yaml_with_findings(self):
        md = _make_review_yaml([_make_finding()])
        result = tri.extract_yaml_block(md)
        assert result is not None
        assert "findings" in result
        assert len(result["findings"]) == 1

    def test_multiple_yaml_blocks_picks_one_with_findings(self):
        non_finding_block = "```yaml\nfoo: bar\nbaz: 1\n```\n"
        finding_block = _make_review_yaml([_make_finding(title="The real one")])
        md = non_finding_block + "\n\n" + finding_block
        result = tri.extract_yaml_block(md)
        assert result is not None
        assert result["findings"][0]["title"] == "The real one"

    def test_no_yaml_blocks_returns_none(self):
        md = "# Just a heading\n\nSome plain text.\n"
        assert tri.extract_yaml_block(md) is None

    def test_malformed_yaml_returns_none(self):
        md = "```yaml\n{invalid: yaml: [: broken\n```\n"
        assert tri.extract_yaml_block(md) is None

    def test_empty_string_returns_none(self):
        assert tri.extract_yaml_block("") is None

    def test_yaml_block_without_findings_key_returns_none(self):
        md = "```yaml\nreview:\n  model: claude\n```\n"
        assert tri.extract_yaml_block(md) is None

    def test_yml_fence_also_accepted(self):
        """The regex accepts both ```yaml and ```yml."""
        data = {"findings": [_make_finding()]}
        yaml_str = yaml.dump(data, default_flow_style=False)
        md = f"```yml\n{yaml_str}```\n"
        result = tri.extract_yaml_block(md)
        assert result is not None
        assert "findings" in result


# ═══════════════════════════════════════════════════════════════
# 2. Finding Validation — validate_finding, validate_review
# ═══════════════════════════════════════════════════════════════


class TestValidateFinding:
    def test_valid_finding_no_warnings(self):
        warnings = tri.validate_finding(_make_finding(), "test")
        assert warnings == []

    def test_missing_required_fields(self):
        finding = {"id": "F-001", "severity": "high", "watchdog": "WD-SH"}
        warnings = tri.validate_finding(finding, "test")
        assert len(warnings) > 0
        assert any("missing fields" in w for w in warnings)

    def test_invalid_severity(self):
        finding = _make_finding(severity="extreme")
        warnings = tri.validate_finding(finding, "test")
        assert any("invalid severity" in w for w in warnings)

    def test_invalid_watchdog_category(self):
        finding = _make_finding(watchdog="WD-BOGUS")
        warnings = tri.validate_finding(finding, "test")
        assert any("unknown watchdog" in w for w in warnings)

    def test_non_string_field_types(self):
        finding = _make_finding(title=12345)
        warnings = tri.validate_finding(finding, "test")
        assert any("'title' should be a string" in w for w in warnings)

    def test_non_dict_finding(self):
        warnings = tri.validate_finding("not a dict", "test")
        assert any("not a dict" in w for w in warnings)

    def test_severity_non_string_type(self):
        finding = _make_finding(severity=3)
        warnings = tri.validate_finding(finding, "test")
        assert any("severity must be a string" in w for w in warnings)

    def test_watchdog_non_string_type(self):
        finding = _make_finding(watchdog=42)
        warnings = tri.validate_finding(finding, "test")
        assert any("watchdog must be a string" in w for w in warnings)


class TestValidateReview:
    def test_valid_review_no_warnings(self):
        data = {
            "review": {
                "model": "claude",
                "date": "2026-03-08",
                "branches": ["main"],
                "base_commit": "abc123",
            },
            "findings": [_make_finding()],
        }
        warnings = tri.validate_review(data, "test")
        assert warnings == []

    def test_missing_review_metadata(self):
        data = {"findings": [_make_finding()]}
        warnings = tri.validate_review(data, "test")
        assert any("missing 'review' metadata" in w for w in warnings)

    def test_missing_base_commit(self):
        data = {
            "review": {"model": "claude", "date": "2026-03-08", "branches": ["main"]},
            "findings": [_make_finding()],
        }
        warnings = tri.validate_review(data, "test")
        assert any("base_commit" in w for w in warnings)

    def test_empty_findings_warns(self):
        data = {
            "review": {
                "model": "claude",
                "date": "2026-03-08",
                "branches": ["main"],
                "base_commit": "abc123",
            },
            "findings": [],
        }
        warnings = tri.validate_review(data, "test")
        assert any("no findings" in w for w in warnings)


# ═══════════════════════════════════════════════════════════════
# 3. Similarity & Matching
# ═══════════════════════════════════════════════════════════════


class TestSimilarity:
    def test_identical_strings(self):
        assert tri.similarity("hello world", "hello world") == pytest.approx(1.0)

    def test_completely_different_strings(self):
        score = tri.similarity("aaa", "zzz")
        assert score < 0.1

    def test_case_insensitive(self):
        assert tri.similarity("Hello", "hello") == pytest.approx(1.0)

    def test_empty_strings(self):
        # SequenceMatcher returns 1.0 for two empty strings
        assert tri.similarity("", "") == pytest.approx(1.0)

    def test_one_empty_string(self):
        assert tri.similarity("something", "") == pytest.approx(0.0)

    def test_partial_match(self):
        score = tri.similarity("missing null check", "null check missing")
        assert 0.3 < score < 1.0  # Related but reordered


class TestComputePairwiseScores:
    def test_same_review_findings_never_compared(self):
        """Findings from the same review (same rid) must never be matched."""
        all_findings = [
            ("R1", _make_finding(title="Foo", file="a.ts")),
            ("R1", _make_finding(title="Foo", file="a.ts")),
        ]
        scores = tri.compute_pairwise_scores(all_findings, threshold=0.0)
        assert len(scores) == 0

    def test_below_threshold_excluded(self):
        all_findings = [
            ("R1", _make_finding(title="aaa bbb ccc", file="x.ts")),
            ("R2", _make_finding(title="zzz yyy xxx", file="q.ts")),
        ]
        scores = tri.compute_pairwise_scores(all_findings, threshold=0.5)
        assert len(scores) == 0

    def test_above_threshold_included(self):
        all_findings = [
            ("R1", _make_finding(title="Missing null check", file="engine.ts")),
            ("R2", _make_finding(title="Missing null check", file="engine.ts")),
        ]
        scores = tri.compute_pairwise_scores(all_findings, threshold=0.5)
        assert len(scores) == 1
        assert scores[0][2] > 0.5

    def test_sorted_descending(self):
        all_findings = [
            ("R1", _make_finding(title="Missing null check", file="a.ts")),
            ("R2", _make_finding(title="Missing null check", file="a.ts")),
            ("R3", _make_finding(title="Missing null check sort of", file="b.ts")),
        ]
        scores = tri.compute_pairwise_scores(all_findings, threshold=0.3)
        for k in range(len(scores) - 1):
            assert scores[k][2] >= scores[k + 1][2]

    def test_combined_score_weighting(self):
        """Score = 0.3 * file_sim + 0.7 * title_sim."""
        all_findings = [
            ("R1", _make_finding(title="Same title", file="different_file.ts")),
            ("R2", _make_finding(title="Same title", file="other_file.ts")),
        ]
        scores = tri.compute_pairwise_scores(all_findings, threshold=0.0)
        assert len(scores) == 1
        # Title matches perfectly (1.0), file partial match
        # So combined should be > 0.7 (the title weight alone)
        assert scores[0][2] > 0.7


class TestMatchFindings:
    def test_zero_findings_zero_groups(self):
        groups = tri.match_findings({})
        assert groups == []

    def test_single_finding_per_review_exact_match(self):
        reviews = {
            "R1": [_make_finding(title="Null check bug", file="a.ts")],
            "R2": [_make_finding(title="Null check bug", file="a.ts")],
        }
        groups = tri.match_findings(reviews)
        converged = [g for g in groups if len(g["convergence"]) == 2]
        assert len(converged) == 1
        assert "R1" in converged[0]["convergence"]
        assert "R2" in converged[0]["convergence"]

    def test_single_finding_per_review_no_match(self):
        reviews = {
            "R1": [_make_finding(title="aaa bbb ccc", file="x.ts")],
            "R2": [_make_finding(title="zzz yyy www", file="q.ts")],
        }
        groups = tri.match_findings(reviews)
        singletons = [g for g in groups if len(g["convergence"]) == 1]
        assert len(singletons) == 2

    def test_singletons_for_unmatched(self):
        reviews = {
            "R1": [
                _make_finding(title="Matched finding", file="a.ts"),
                _make_finding(id="F-002", title="Unique to R1", file="b.ts"),
            ],
            "R2": [
                _make_finding(title="Matched finding", file="a.ts"),
            ],
        }
        groups = tri.match_findings(reviews)
        singletons = [g for g in groups if len(g["convergence"]) == 1]
        assert len(singletons) == 1
        assert singletons[0]["convergence"] == ["R1"]

    def test_one_finding_per_review_per_group(self):
        """No review should appear more than once in a single group."""
        reviews = {
            "R1": [
                _make_finding(title="Similar A", file="a.ts"),
                _make_finding(id="F-002", title="Similar A variant", file="a.ts"),
            ],
            "R2": [
                _make_finding(title="Similar A", file="a.ts"),
            ],
        }
        groups = tri.match_findings(reviews)
        for g in groups:
            rids = g["convergence"]
            assert len(rids) == len(set(rids)), f"Duplicate review in group: {rids}"

    def test_greedy_best_first_highest_score_consumed(self):
        """The pair with the highest combined score should be matched first."""
        reviews = {
            "R1": [_make_finding(title="Exact match title", file="engine.ts")],
            "R2": [
                _make_finding(title="Exact match title", file="engine.ts"),
                _make_finding(id="F-002", title="Partially similar", file="engine.ts"),
            ],
        }
        groups = tri.match_findings(reviews)
        # R1 F-001 should match R2 F-001 (exact), not R2 F-002
        matched_group = [g for g in groups if len(g["convergence"]) == 2]
        assert len(matched_group) == 1
        r2_finding = matched_group[0]["matched_findings"]["R2"]
        assert r2_finding["title"] == "Exact match title"

    def test_three_way_match(self):
        reviews = {
            "R1": [_make_finding(title="Same finding everywhere", file="a.ts")],
            "R2": [_make_finding(title="Same finding everywhere", file="a.ts")],
            "R3": [_make_finding(title="Same finding everywhere", file="a.ts")],
        }
        groups = tri.match_findings(reviews)
        three_way = [g for g in groups if len(g["convergence"]) == 3]
        assert len(three_way) == 1

    def test_canonical_severity_is_highest(self):
        reviews = {
            "R1": [_make_finding(title="Same bug", file="a.ts", severity="low")],
            "R2": [_make_finding(title="Same bug", file="a.ts", severity="critical")],
        }
        groups = tri.match_findings(reviews)
        matched = [g for g in groups if len(g["convergence"]) == 2][0]
        assert matched["canonical_severity"] == "critical"

    def test_match_confidence_is_not_none_for_matched(self):
        reviews = {
            "R1": [_make_finding(title="Matched", file="a.ts")],
            "R2": [_make_finding(title="Matched", file="a.ts")],
        }
        groups = tri.match_findings(reviews)
        matched = [g for g in groups if len(g["convergence"]) == 2][0]
        assert matched["match_confidence"] is not None
        assert 0.0 < matched["match_confidence"] <= 1.0

    def test_match_confidence_none_for_singleton(self):
        reviews = {
            "R1": [_make_finding(title="Only here", file="a.ts")],
            "R2": [_make_finding(title="Totally different", file="z.ts")],
        }
        groups = tri.match_findings(reviews)
        singletons = [g for g in groups if len(g["convergence"]) == 1]
        for s in singletons:
            assert s["match_confidence"] is None

    def test_custom_threshold(self):
        """A high threshold should produce fewer matches."""
        reviews = {
            "R1": [_make_finding(title="Missing null check in bout", file="engine.ts")],
            "R2": [
                _make_finding(
                    title="Null check absent from bout engine", file="engine.ts"
                )
            ],
        }
        groups_low = tri.match_findings(reviews, threshold=0.3)
        groups_high = tri.match_findings(reviews, threshold=0.95)
        converged_low = [g for g in groups_low if len(g["convergence"]) >= 2]
        converged_high = [g for g in groups_high if len(g["convergence"]) >= 2]
        assert len(converged_low) >= len(converged_high)


# ═══════════════════════════════════════════════════════════════
# 4. _avg_similarity_to_group
# ═══════════════════════════════════════════════════════════════


class TestAvgSimilarityToGroup:
    def test_returns_average_similarity(self):
        finding = _make_finding(title="Missing null check", file="a.ts")
        group = {
            "matched_findings": {
                "R1": _make_finding(title="Missing null check", file="a.ts"),
            },
        }
        # all_findings is passed but unused in the implementation
        score = tri._avg_similarity_to_group(finding, group, [])
        assert score == pytest.approx(1.0)

    def test_average_across_multiple_members(self):
        finding = _make_finding(title="Missing null check", file="a.ts")
        group = {
            "matched_findings": {
                "R1": _make_finding(title="Missing null check", file="a.ts"),
                "R2": _make_finding(title="Something else entirely", file="z.ts"),
            },
        }
        score = tri._avg_similarity_to_group(finding, group, [])
        # Should be average of ~1.0 (R1 match) and ~0.x (R2 mismatch)
        assert 0.3 < score < 0.9

    def test_all_findings_parameter_is_unused(self):
        """BUG: all_findings parameter is accepted but never used (2-way, LOW).

        The function signature accepts all_findings but the implementation
        only uses group["matched_findings"]. The parameter could be removed.
        This test documents the bug by proving the result is identical
        regardless of what is passed for all_findings.
        """
        finding = _make_finding(title="Test", file="a.ts")
        group = {
            "matched_findings": {
                "R1": _make_finding(title="Test", file="a.ts"),
            },
        }
        score_empty = tri._avg_similarity_to_group(finding, group, [])
        score_with_data = tri._avg_similarity_to_group(
            finding,
            group,
            [("R1", _make_finding()), ("R2", _make_finding()), ("R3", _make_finding())],
        )
        assert score_empty == score_with_data

    def test_empty_group_returns_zero(self):
        finding = _make_finding()
        group = {"matched_findings": {}}
        assert tri._avg_similarity_to_group(finding, group, []) == 0.0


# ═══════════════════════════════════════════════════════════════
# 5. Metrics — compute_metrics
# ═══════════════════════════════════════════════════════════════


class TestComputeMetrics:
    """Tests for compute_metrics, including documentation of known bugs."""

    def _build_groups_and_call(self, groups, review_ids, reviews_data=None):
        """Helper: call compute_metrics with sensible defaults."""
        if reviews_data is None:
            reviews_data = _make_reviews_data(review_ids)
        return tri.compute_metrics(groups, review_ids, reviews_data)

    # -- converged_2plus --

    def test_converged_2plus_n2_double_count_bug(self):
        """BUG: converged_2plus double-counts for N=2 (Gemini F-001, HIGH).

        When N=2, converged_all and converged_2 both count the same groups
        (any group with 2 reviews hits BOTH len==n_reviews AND len==2).
        The local variable converged_2plus = converged_all + converged_2 = 2x
        the actual count. This surfaces in rate_2plus.

        EXPECTED: rate_2plus should equal converged_groups / total, not 2x.
        """
        review_ids = ["R1", "R2"]
        # One group converged by both reviews, one singleton
        groups = [
            {
                "matched_findings": {
                    "R1": _make_finding(title="A"),
                    "R2": _make_finding(title="A"),
                },
                "convergence": ["R1", "R2"],
                "canonical_title": "A",
                "canonical_file": "a.ts",
                "canonical_severity": "high",
                "match_confidence": 0.9,
            },
            {
                "matched_findings": {"R1": _make_finding(title="B")},
                "convergence": ["R1"],
                "canonical_title": "B",
                "canonical_file": "b.ts",
                "canonical_severity": "low",
                "match_confidence": None,
            },
        ]
        metrics = self._build_groups_and_call(groups, review_ids)
        cr = metrics["convergence_rate"]

        # BUG: converged_all=1 (len==2==n_reviews), converged_2=1 (len==2)
        # internally converged_2plus = 1+1 = 2, but only 1 group is actually converged
        assert cr["converged_all"] == 1
        assert cr["converged_2"] == 1
        # rate_2plus = converged_2plus/total = 2/2 = 1.0
        assert (
            cr["rate_2plus"] == 1.0
        )  # BUG: should be 0.5 (1 converged out of 2 groups)
        # EXPECTED: rate_2plus == 0.5

    def test_converged_2plus_n3_correct(self):
        """For N=3, converged_2 and converged_all are disjoint — correct.

        converged_all counts len==3, converged_2 counts len==2.
        These are disjoint for N=3, so rate_2plus is correct.
        """
        review_ids = ["R1", "R2", "R3"]
        groups = [
            {
                "matched_findings": {
                    "R1": _make_finding(),
                    "R2": _make_finding(),
                    "R3": _make_finding(),
                },
                "convergence": ["R1", "R2", "R3"],
                "canonical_title": "All three",
                "canonical_file": "a.ts",
                "canonical_severity": "high",
                "match_confidence": 0.9,
            },
            {
                "matched_findings": {
                    "R1": _make_finding(title="Two only"),
                    "R2": _make_finding(title="Two only"),
                },
                "convergence": ["R1", "R2"],
                "canonical_title": "Two only",
                "canonical_file": "b.ts",
                "canonical_severity": "medium",
                "match_confidence": 0.8,
            },
            {
                "matched_findings": {"R3": _make_finding(title="Singleton")},
                "convergence": ["R3"],
                "canonical_title": "Singleton",
                "canonical_file": "c.ts",
                "canonical_severity": "low",
                "match_confidence": None,
            },
        ]
        metrics = self._build_groups_and_call(groups, review_ids)
        cr = metrics["convergence_rate"]

        assert cr["converged_all"] == 1  # len==3==n_reviews
        assert cr["converged_2"] == 1  # len==2
        # rate_2plus = (1+1)/3 ≈ 0.6667 — correct for N=3
        assert cr["rate_2plus"] == pytest.approx(2 / 3, abs=0.001)
        assert cr["single_model"] == 1

    def test_converged_2plus_n4_misses_intermediate_bug(self):
        """BUG: converged_2plus misses intermediate convergence sizes for N>3 (Gemini, HIGH).

        For N=4, a group converged by exactly 3 reviews has len(convergence)==3,
        which is != n_reviews (4) and != 2, so it's counted in NEITHER
        converged_all NOR converged_2. The internal converged_2plus = 0+0 = 0,
        and rate_2plus = 0. But there IS a converged group.

        EXPECTED: rate_2plus should reflect all groups with len >= 2.
        """
        review_ids = ["R1", "R2", "R3", "R4"]
        groups = [
            {
                "matched_findings": {
                    "R1": _make_finding(),
                    "R2": _make_finding(),
                    "R3": _make_finding(),
                },
                "convergence": ["R1", "R2", "R3"],  # 3 of 4 — intermediate
                "canonical_title": "Three way",
                "canonical_file": "a.ts",
                "canonical_severity": "high",
                "match_confidence": 0.85,
            },
        ]
        metrics = self._build_groups_and_call(groups, review_ids)
        cr = metrics["convergence_rate"]

        # BUG: converged_all = 0 (len 3 != 4), converged_2 = 0 (len 3 != 2)
        # rate_2plus = 0/1 = 0, but there IS a converged group (3-way)
        assert cr["converged_all"] == 0
        assert cr["converged_2"] == 0
        assert cr["rate_2plus"] == 0  # BUG: should be 1.0 (1 converged / 1 total)
        # EXPECTED: rate_2plus == 1.0

    # -- match_confidence --

    def test_match_confidence_spanning_tree_bug(self):
        """BUG: match_confidence averages N-1 spanning-tree edges instead of
        all N*(N-1)/2 pairwise scores (3-way, HIGH).

        For a 3-way match, there are 3 pairwise combinations (AB, AC, BC),
        but the greedy algorithm only records 2 edges (the spanning tree).
        match_confidence is the average of those 2 edges, not all 3 pairs.

        This test documents the behavior: for a 3-way match, _scores
        has 2 entries (N-1), not 3 (N*(N-1)/2).
        """
        reviews = {
            "R1": [_make_finding(title="Same exact finding", file="same.ts")],
            "R2": [_make_finding(title="Same exact finding", file="same.ts")],
            "R3": [_make_finding(title="Same exact finding", file="same.ts")],
        }
        groups = tri.match_findings(reviews)
        three_way = [g for g in groups if len(g["convergence"]) == 3]
        assert len(three_way) == 1

        # The match_confidence is computed from _scores which has N-1 entries
        # for the spanning tree, not N*(N-1)/2 for all pairwise comparisons.
        # For 3 identical findings, each pairwise score is ~1.0, so the average
        # is still ~1.0 — the bug only manifests when scores differ across pairs.
        # We can't inspect _scores directly (it's deleted), but we verify the
        # confidence is present and reasonable.
        conf = three_way[0]["match_confidence"]
        assert conf is not None
        assert conf == pytest.approx(1.0, abs=0.01)

    # -- match_diagnostics threshold --

    def test_match_diagnostics_hardcodes_threshold_bug(self):
        """BUG: match_diagnostics hardcodes threshold=0.6 regardless of
        --match-threshold (Codex-only, MEDIUM).

        Even when a different threshold is used for matching, the diagnostics
        always report 0.6.
        """
        review_ids = ["R1", "R2"]
        reviews_data = _make_reviews_data(review_ids)
        groups = [
            {
                "matched_findings": {
                    "R1": _make_finding(),
                    "R2": _make_finding(),
                },
                "convergence": ["R1", "R2"],
                "canonical_title": "A",
                "canonical_file": "a.ts",
                "canonical_severity": "high",
                "match_confidence": 0.85,
            },
        ]
        # Even though we would have used threshold=0.8, compute_metrics
        # doesn't receive the threshold — it hardcodes 0.6
        metrics = tri.compute_metrics(groups, review_ids, reviews_data)

        # BUG: Always 0.6 regardless of actual threshold used
        assert metrics["match_diagnostics"]["threshold"] == 0.6
        # EXPECTED: threshold should reflect the actual value used for matching

    # -- marginal value --

    def test_marginal_value_dispatch_order(self):
        """Marginal value dispatch_order uses the original review_ids order."""
        review_ids = ["R1", "R2"]
        reviews_data = _make_reviews_data(review_ids)
        groups = [
            {
                "matched_findings": {
                    "R1": _make_finding(title="Shared"),
                    "R2": _make_finding(title="Shared"),
                },
                "convergence": ["R1", "R2"],
                "canonical_title": "Shared",
                "canonical_file": "a.ts",
                "canonical_severity": "high",
                "match_confidence": 0.9,
            },
            {
                "matched_findings": {"R1": _make_finding(title="Unique")},
                "convergence": ["R1"],
                "canonical_title": "Unique",
                "canonical_file": "b.ts",
                "canonical_severity": "low",
                "match_confidence": None,
            },
        ]
        metrics = tri.compute_metrics(groups, review_ids, reviews_data)
        mv = metrics["marginal_value"]
        dispatch = mv["dispatch_order"]["cumulative"]

        # R1 goes first: sees both groups → 2 new
        assert dispatch[0]["review_id"] == "R1"
        assert dispatch[0]["new_unique"] == 2
        assert dispatch[0]["cumulative_unique"] == 2

        # R2 goes second: Shared already seen, so 0 new
        assert dispatch[1]["review_id"] == "R2"
        assert dispatch[1]["new_unique"] == 0
        assert dispatch[1]["cumulative_unique"] == 2

    def test_marginal_value_permutations_count(self):
        """N reviews should produce N! permutations."""
        review_ids = ["R1", "R2", "R3"]
        reviews_data = _make_reviews_data(review_ids)
        groups = [
            {
                "matched_findings": {"R1": _make_finding()},
                "convergence": ["R1"],
                "canonical_title": "A",
                "canonical_file": "a.ts",
                "canonical_severity": "low",
                "match_confidence": None,
            },
        ]
        metrics = tri.compute_metrics(groups, review_ids, reviews_data)
        assert metrics["marginal_value"]["n_permutations"] == 6  # 3!

    # -- severity distribution --

    def test_severity_distribution_counts(self):
        review_ids = ["R1", "R2"]
        reviews_data = _make_reviews_data(review_ids)
        groups = [
            {
                "matched_findings": {
                    "R1": _make_finding(severity="high"),
                    "R2": _make_finding(severity="medium"),
                },
                "convergence": ["R1", "R2"],
                "canonical_title": "A",
                "canonical_file": "a.ts",
                "canonical_severity": "high",
                "match_confidence": 0.9,
            },
            {
                "matched_findings": {"R1": _make_finding(severity="low")},
                "convergence": ["R1"],
                "canonical_title": "B",
                "canonical_file": "b.ts",
                "canonical_severity": "low",
                "match_confidence": None,
            },
        ]
        metrics = tri.compute_metrics(groups, review_ids, reviews_data)
        sd = metrics["severity_distribution"]

        assert sd["R1"]["high"] == 1
        assert sd["R1"]["low"] == 1
        assert sd["R2"]["medium"] == 1
        assert sd["R2"]["high"] == 0

    # -- severity calibration --

    def test_severity_calibration_agreement(self):
        review_ids = ["R1", "R2"]
        reviews_data = _make_reviews_data(review_ids)
        groups = [
            {
                "matched_findings": {
                    "R1": _make_finding(severity="high"),
                    "R2": _make_finding(severity="high"),
                },
                "convergence": ["R1", "R2"],
                "canonical_title": "Agreed",
                "canonical_file": "a.ts",
                "canonical_severity": "high",
                "match_confidence": 0.9,
            },
        ]
        metrics = tri.compute_metrics(groups, review_ids, reviews_data)
        cal = metrics["severity_calibration"]
        assert len(cal) == 1
        assert cal[0]["agreement"] is True
        assert cal[0]["max_delta"] == 0

    def test_severity_calibration_disagreement(self):
        review_ids = ["R1", "R2"]
        reviews_data = _make_reviews_data(review_ids)
        groups = [
            {
                "matched_findings": {
                    "R1": _make_finding(severity="critical"),
                    "R2": _make_finding(severity="low"),
                },
                "convergence": ["R1", "R2"],
                "canonical_title": "Disagreed",
                "canonical_file": "a.ts",
                "canonical_severity": "critical",
                "match_confidence": 0.8,
            },
        ]
        metrics = tri.compute_metrics(groups, review_ids, reviews_data)
        cal = metrics["severity_calibration"]
        assert len(cal) == 1
        assert cal[0]["agreement"] is False
        assert cal[0]["max_delta"] == 3  # critical(4) - low(1)

    def test_singleton_excluded_from_calibration(self):
        review_ids = ["R1", "R2"]
        reviews_data = _make_reviews_data(review_ids)
        groups = [
            {
                "matched_findings": {"R1": _make_finding()},
                "convergence": ["R1"],
                "canonical_title": "Singleton",
                "canonical_file": "a.ts",
                "canonical_severity": "high",
                "match_confidence": None,
            },
        ]
        metrics = tri.compute_metrics(groups, review_ids, reviews_data)
        assert metrics["severity_calibration"] == []

    # -- finding_count --

    def test_finding_count_unique_vs_shared(self):
        review_ids = ["R1", "R2"]
        reviews_data = _make_reviews_data(review_ids)
        groups = [
            {
                "matched_findings": {
                    "R1": _make_finding(),
                    "R2": _make_finding(),
                },
                "convergence": ["R1", "R2"],
                "canonical_title": "Shared",
                "canonical_file": "a.ts",
                "canonical_severity": "high",
                "match_confidence": 0.9,
            },
            {
                "matched_findings": {"R1": _make_finding(title="Only R1")},
                "convergence": ["R1"],
                "canonical_title": "Only R1",
                "canonical_file": "b.ts",
                "canonical_severity": "low",
                "match_confidence": None,
            },
        ]
        metrics = tri.compute_metrics(groups, review_ids, reviews_data)
        fc = metrics["finding_count"]
        assert fc["R1"]["total"] == 2
        assert fc["R1"]["unique"] == 1
        assert fc["R2"]["total"] == 1
        assert fc["R2"]["unique"] == 0


# ═══════════════════════════════════════════════════════════════
# 6. CLI Parser — parse_cli_args
# ═══════════════════════════════════════════════════════════════


class TestParseCliArgs:
    def test_out_flag_before_files(self):
        files, options = tri.parse_cli_args(["--out", "dir", "file1", "file2"])
        assert options == {"--out": "dir"}
        assert files == ["file1", "file2"]

    def test_files_before_out_flag(self):
        files, options = tri.parse_cli_args(["file1", "file2", "--out", "dir"])
        assert options == {"--out": "dir"}
        assert files == ["file1", "file2"]

    def test_multiple_options(self):
        files, options = tri.parse_cli_args(
            [
                "--out",
                "dir",
                "--match-threshold",
                "0.8",
                "file1",
                "file2",
            ]
        )
        assert options == {"--out": "dir", "--match-threshold": "0.8"}
        assert files == ["file1", "file2"]

    def test_no_options(self):
        files, options = tri.parse_cli_args(["file1", "file2"])
        assert options == {}
        assert files == ["file1", "file2"]

    def test_dangling_flag_at_end_bug(self):
        """BUG: --out at end without value is treated as a positional file path
        (2 reviewers, CLI parser bug).

        When --out is the last argument with no value following it,
        args[i].startswith("--") is True but i+1 < len(args) is False,
        so it falls through to the else branch and is appended to files.

        EXPECTED: Should either error or store --out with None value.
        """
        files, options = tri.parse_cli_args(["file1", "file2", "--out"])
        # BUG: --out treated as a file path
        assert "--out" in files
        assert "--out" not in options
        # EXPECTED: "--out" should be in options or trigger an error

    def test_boolean_flag_swallows_next_arg_bug(self):
        """BUG: Boolean-style flags like --verbose swallow the next argument
        (2 reviewers, CLI parser bug).

        The parser always assumes --flag is followed by a value, so
        --verbose file1 treats file1 as the value for --verbose.

        EXPECTED: Boolean flags should be stored with True value,
        not consume the next positional argument.
        """
        files, options = tri.parse_cli_args(["--verbose", "file1", "file2"])
        # BUG: file1 is consumed as the value for --verbose
        assert options == {"--verbose": "file1"}
        assert files == ["file2"]
        # EXPECTED: options == {"--verbose": True}, files == ["file1", "file2"]

    def test_interleaved_flags_and_files(self):
        files, options = tri.parse_cli_args(
            [
                "file1",
                "--out",
                "dir",
                "file2",
                "--run",
                "test-run",
            ]
        )
        assert options == {"--out": "dir", "--run": "test-run"}
        assert files == ["file1", "file2"]


# ═══════════════════════════════════════════════════════════════
# 7. Output Formatting — format_summary
# ═══════════════════════════════════════════════════════════════


class TestFormatSummary:
    def _format(self, groups, review_ids, reviews_data=None):
        if reviews_data is None:
            reviews_data = _make_reviews_data(review_ids)
        metrics = tri.compute_metrics(groups, review_ids, reviews_data)
        return tri.format_summary(groups, metrics, review_ids, reviews_data)

    def test_n2_display_bug_from_double_count(self):
        """BUG: N=2 summary "2 of 2 models" line shows wrong percentage
        due to cascading from the converged_2plus double-count bug (Codex, LOW).

        For N=2, format_summary skips the "All N models" line (only shown
        for n_reviews >= 3). The "2 of N" line shows rate_2only which is
        computed as rate_2plus - rate_all.

        With the double-count bug: rate_2plus = 2.0 (2/1), rate_all = 1.0 (1/1).
        So rate_2only = 2.0 - 1.0 = 1.0 → 100.0%.

        EXPECTED: For N=2 with 1 converged group out of 1 total, the "2 of 2"
        line should show 100.0% (correct) or the "All 2" line should be shown
        instead. The current output happens to display the right count (1)
        but the percentage calculation is wrong (it's 100% for the wrong reason).
        """
        review_ids = ["R1", "R2"]
        groups = [
            {
                "matched_findings": {
                    "R1": _make_finding(),
                    "R2": _make_finding(),
                },
                "convergence": ["R1", "R2"],
                "canonical_title": "Converged",
                "canonical_file": "a.ts",
                "canonical_severity": "high",
                "match_confidence": 0.9,
            },
        ]
        output = self._format(groups, review_ids)

        # For N=2, "All N models" line is NOT shown (n_reviews < 3)
        assert "All 2 models:" not in output
        # Only the "2 of 2" line is shown
        assert "2 of 2 models:" in output
        # The percentage shown is rate_2only = rate_2plus - rate_all = 100.0%
        # This is coincidentally "correct" looking (100%) but computed wrong:
        # rate_2plus = 2.0 (double-counted), rate_all = 1.0 → diff = 1.0
        assert "100.0%" in output

    def test_converged_findings_appear(self):
        review_ids = ["R1", "R2"]
        groups = [
            {
                "matched_findings": {
                    "R1": _make_finding(title="Important Bug"),
                    "R2": _make_finding(title="Important Bug"),
                },
                "convergence": ["R1", "R2"],
                "canonical_title": "Important Bug",
                "canonical_file": "a.ts",
                "canonical_severity": "high",
                "match_confidence": 0.9,
            },
        ]
        output = self._format(groups, review_ids)
        assert "CONVERGED FINDINGS" in output
        assert "Important Bug" in output

    def test_single_model_findings_appear(self):
        review_ids = ["R1", "R2"]
        reviews_data = _make_reviews_data(review_ids, models=["claude", "gpt-4"])
        groups = [
            {
                "matched_findings": {
                    "R1": _make_finding(title="Only Claude Found This")
                },
                "convergence": ["R1"],
                "canonical_title": "Only Claude Found This",
                "canonical_file": "a.ts",
                "canonical_severity": "medium",
                "match_confidence": None,
            },
            {
                "matched_findings": {"R2": _make_finding(title="Only GPT Found This")},
                "convergence": ["R2"],
                "canonical_title": "Only GPT Found This",
                "canonical_file": "b.ts",
                "canonical_severity": "low",
                "match_confidence": None,
            },
        ]
        output = self._format(groups, review_ids, reviews_data)
        assert "SINGLE-MODEL FINDINGS" in output
        assert "Only Claude Found This" in output
        assert "Only GPT Found This" in output

    def test_summary_contains_header_and_footer(self):
        review_ids = ["R1", "R2"]
        groups = []
        output = self._format(groups, review_ids)
        assert "DARKCAT ALLEY" in output
        assert "Computed:" in output

    def test_match_diagnostics_in_summary(self):
        review_ids = ["R1", "R2"]
        groups = [
            {
                "matched_findings": {
                    "R1": _make_finding(),
                    "R2": _make_finding(),
                },
                "convergence": ["R1", "R2"],
                "canonical_title": "A",
                "canonical_file": "a.ts",
                "canonical_severity": "high",
                "match_confidence": 0.85,
            },
        ]
        output = self._format(groups, review_ids)
        assert "MATCH DIAGNOSTICS" in output
        assert "Avg confidence" in output


# ═══════════════════════════════════════════════════════════════
# 8. Export — write_yaml and cmd_metrics bypass
# ═══════════════════════════════════════════════════════════════


class TestWriteYaml:
    def test_uses_block_style_for_multiline_strings(self, tmp_path):
        """write_yaml uses MultilineDumper — long/multiline strings use block style."""
        outfile = tmp_path / "test.yaml"
        data = {
            "description": "This is a long string that exceeds one hundred characters in length to trigger the block scalar style in the multiline dumper implementation."
        }
        tri.write_yaml(outfile, data)
        raw = outfile.read_text()
        # Block scalar indicator
        assert "|" in raw

    def test_uses_block_style_for_newline_strings(self, tmp_path):
        outfile = tmp_path / "test.yaml"
        data = {"text": "line one\nline two\nline three"}
        tri.write_yaml(outfile, data)
        raw = outfile.read_text()
        assert "|" in raw

    def test_short_strings_remain_inline(self, tmp_path):
        outfile = tmp_path / "test.yaml"
        data = {"name": "short"}
        tri.write_yaml(outfile, data)
        raw = outfile.read_text()
        assert "name: short" in raw

    def test_roundtrip_preserves_data(self, tmp_path):
        outfile = tmp_path / "test.yaml"
        data = {
            "findings": [
                {"title": "Bug A", "severity": "high"},
                {"title": "Bug B", "severity": "low"},
            ],
        }
        tri.write_yaml(outfile, data)
        loaded = yaml.safe_load(outfile.read_text())
        assert loaded == data


class TestCmdMetricsBypassBug:
    """BUG: cmd_metrics uses plain yaml.dump, bypasses MultilineDumper (Gemini, MEDIUM).

    write_yaml defines a MultilineDumper that renders long strings as block scalars.
    cmd_metrics (line 892) calls yaml.dump(metrics, sys.stdout, ...) directly,
    without using MultilineDumper. This means metrics output to stdout does not
    get the readable block scalar formatting.

    We document this by inspecting the source code rather than running the CLI,
    since the bug is in the code path, not in the output format for simple data.
    """

    def test_cmd_metrics_does_not_use_multiline_dumper(self):
        """Verify cmd_metrics calls yaml.dump directly, not write_yaml."""
        import inspect

        source = inspect.getsource(tri.cmd_metrics)
        # cmd_metrics calls yaml.dump directly
        assert "yaml.dump" in source
        # It does NOT call write_yaml or use MultilineDumper
        assert "write_yaml" not in source
        assert "MultilineDumper" not in source


# ═══════════════════════════════════════════════════════════════
# 9. Docstring vs Implementation mismatch (meta-documentation)
# ═══════════════════════════════════════════════════════════════


class TestDocstringMismatch:
    """BUG: match_findings docstring says "max-weight bipartite" but the
    implementation is greedy best-first with no group merging (2-way, HIGH).

    This test documents the discrepancy by checking the docstring contains
    the misleading term and verifying the implementation behavior differs.
    """

    def test_docstring_says_bipartite(self):
        assert "bipartite" in tri.match_findings.__doc__

    def test_implementation_is_greedy_no_merge(self):
        """Greedy: once both findings are in different groups, they are NOT merged.

        A true bipartite/optimal matching would consider merging groups.
        The greedy algorithm skips when both are assigned (line 230: 'continue').
        """
        # Create a scenario where merging would help but greedy doesn't do it.
        # R1-A matches R2-A well (0.95), R1-A matches R3-A well (0.95),
        # but R2-A and R3-A might be in separate groups if consumed in wrong order.
        # With identical titles, greedy happens to work — but the code path
        # explicitly skips merging (line 230: both assigned → continue).
        reviews = {
            "R1": [_make_finding(title="The critical bug", file="engine.ts")],
            "R2": [_make_finding(title="The critical bug", file="engine.ts")],
            "R3": [_make_finding(title="The critical bug", file="engine.ts")],
        }
        groups = tri.match_findings(reviews)
        # For identical findings, greedy still produces a single group
        # because the spanning tree connects them all.
        three_way = [g for g in groups if len(g["convergence"]) == 3]
        assert len(three_way) == 1
        # But the algorithm is still greedy, not bipartite — this is a
        # documentation bug, not necessarily a behavioral bug for simple cases.


# ═══════════════════════════════════════════════════════════════
# 10. Integration-style: parse_review_file
# ═══════════════════════════════════════════════════════════════


class TestParseReviewFile:
    def test_valid_file(self, tmp_path):
        review_md = _make_review_yaml([_make_finding()])
        review_file = tmp_path / "review.md"
        review_file.write_text(review_md)
        data = tri.parse_review_file(str(review_file))
        assert "findings" in data
        assert len(data["findings"]) == 1

    def test_file_not_found(self):
        with pytest.raises(FileNotFoundError):
            tri.parse_review_file("/nonexistent/path/review.md")

    def test_no_yaml_block_raises_value_error(self, tmp_path):
        review_file = tmp_path / "review.md"
        review_file.write_text("# Just a heading\n\nNo YAML here.\n")
        with pytest.raises(ValueError, match="No structured YAML"):
            tri.parse_review_file(str(review_file))


# ═══════════════════════════════════════════════════════════════
# 11. Edge cases for match_findings
# ═══════════════════════════════════════════════════════════════


class TestMatchFindingsEdgeCases:
    def test_single_review_all_singletons(self):
        """A single review isn't valid for multi-review commands, but
        match_findings handles it: all findings become singletons since
        there are no cross-review pairs to compare."""
        reviews = {
            "R1": [
                _make_finding(title="A"),
                _make_finding(id="F-002", title="B"),
            ],
        }
        groups = tri.match_findings(reviews)
        assert len(groups) == 2
        assert all(len(g["convergence"]) == 1 for g in groups)

    def test_many_findings_per_review(self):
        """Stress test: 10 findings per review, each with unique title."""
        reviews = {
            "R1": [
                _make_finding(id=f"F-{i:03d}", title=f"Finding {i}", file=f"f{i}.ts")
                for i in range(10)
            ],
            "R2": [
                _make_finding(id=f"F-{i:03d}", title=f"Finding {i}", file=f"f{i}.ts")
                for i in range(10)
            ],
        }
        groups = tri.match_findings(reviews)
        # All 10 should match across reviews
        matched = [g for g in groups if len(g["convergence"]) == 2]
        assert len(matched) == 10

    def test_empty_titles_and_files(self):
        """Findings with empty titles/files should still be processed."""
        reviews = {
            "R1": [_make_finding(title="", file="")],
            "R2": [_make_finding(title="", file="")],
        }
        groups = tri.match_findings(reviews)
        # Empty strings have similarity 1.0, so they should match
        matched = [g for g in groups if len(g["convergence"]) == 2]
        assert len(matched) == 1


# ═══════════════════════════════════════════════════════════════
# 12. Convergence matrix formatting
# ═══════════════════════════════════════════════════════════════


class TestFormatConvergenceMatrix:
    def test_contains_markdown_table(self):
        review_ids = ["R1", "R2"]
        reviews_data = _make_reviews_data(review_ids, models=["claude", "gpt-4"])
        groups = [
            {
                "matched_findings": {
                    "R1": _make_finding(title="Bug"),
                    "R2": _make_finding(title="Bug"),
                },
                "convergence": ["R1", "R2"],
                "canonical_title": "Bug",
                "canonical_file": "a.ts",
                "canonical_severity": "high",
                "match_confidence": 0.9,
            },
        ]
        output = tri.format_convergence_matrix(groups, review_ids, reviews_data)
        assert "# Convergence Matrix" in output
        assert "| YES " in output
        assert "Bug" in output

    def test_singleton_shows_only(self):
        review_ids = ["R1", "R2"]
        reviews_data = _make_reviews_data(review_ids)
        groups = [
            {
                "matched_findings": {"R1": _make_finding(title="Lone")},
                "convergence": ["R1"],
                "canonical_title": "Lone",
                "canonical_file": "a.ts",
                "canonical_severity": "low",
                "match_confidence": None,
            },
        ]
        output = tri.format_convergence_matrix(groups, review_ids, reviews_data)
        assert "R1 only" in output


# ═══════════════════════════════════════════════════════════════
# 13. Export integration
# ═══════════════════════════════════════════════════════════════


class TestExportAll:
    def test_creates_expected_files(self, tmp_path):
        review_ids = ["R1", "R2"]
        reviews_data = {
            "R1": {
                "review": {
                    "model": "claude",
                    "date": "2026-03-08",
                    "branches": ["main"],
                    "base_commit": "abc",
                },
                "findings": [_make_finding()],
            },
            "R2": {
                "review": {
                    "model": "gpt-4",
                    "date": "2026-03-08",
                    "branches": ["main"],
                    "base_commit": "abc",
                },
                "findings": [_make_finding()],
            },
        }
        reviews = {rid: data["findings"] for rid, data in reviews_data.items()}
        groups = tri.match_findings(reviews)
        metrics = tri.compute_metrics(groups, review_ids, reviews_data)
        out_dir = tmp_path / "export"

        tri.export_all(groups, metrics, review_ids, reviews_data, out_dir, "test-run")

        assert (out_dir / "metadata.yaml").exists()
        assert (out_dir / "R1.yaml").exists()
        assert (out_dir / "R2.yaml").exists()
        assert (out_dir / "convergence.yaml").exists()
        assert (out_dir / "metrics.yaml").exists()
        assert (out_dir / "findings-union.yaml").exists()

    def test_metadata_contains_run_id(self, tmp_path):
        review_ids = ["R1", "R2"]
        reviews_data = _make_reviews_data(review_ids, models=["claude", "gpt-4"])
        # Add findings to reviews_data for completeness
        for rid in review_ids:
            reviews_data[rid]["findings"] = [_make_finding()]
        reviews = {rid: data["findings"] for rid, data in reviews_data.items()}
        groups = tri.match_findings(reviews)
        metrics = tri.compute_metrics(groups, review_ids, reviews_data)
        out_dir = tmp_path / "export2"

        tri.export_all(groups, metrics, review_ids, reviews_data, out_dir, "my-run-id")

        metadata = yaml.safe_load((out_dir / "metadata.yaml").read_text())
        assert metadata["run_id"] == "my-run-id"


# ═══════════════════════════════════════════════════════════════
# 14. Constants validation
# ═══════════════════════════════════════════════════════════════


class TestConstants:
    def test_severity_ordinal_covers_valid_severities(self):
        assert set(tri.SEVERITY_ORDINAL.keys()) == tri.VALID_SEVERITIES

    def test_severity_ordinal_values_unique_and_ordered(self):
        vals = list(tri.SEVERITY_ORDINAL.values())
        # All values are unique (no ties)
        assert len(vals) == len(set(vals))
        # Values span 1-4 for the four severity levels
        assert set(vals) == {1, 2, 3, 4}

    def test_watchdog_ids_include_none(self):
        assert "none" in tri.WATCHDOG_IDS
