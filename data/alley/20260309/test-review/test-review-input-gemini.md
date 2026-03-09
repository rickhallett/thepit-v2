**You are Gemini (gemini-3.1-pro-preview). You are performing an independent adversarial review.**

# Darkcat Review: Test Quality Assessment — bin/test_triangulate.py

## Context

You are reviewing a pytest test file (`bin/test_triangulate.py`, 89 tests) that was written by an AI agent (Watchdog) to test `bin/triangulate`, a Python CLI tool for cross-model code review triangulation.

The test file was written in response to a finding (F-008, HIGH severity) from 3 independent reviewers that the tool had zero test coverage after a 600-line rewrite. The tests aim to document 8 known bugs found by cross-model triangulation.

**Your job is NOT to review `bin/triangulate` (that has already been reviewed). Your job is to review the TESTS.**

## What to Assess

1. **Tautological tests** — Tests that cannot fail when the code is wrong. The test passes because it asserts the output of the function, not because it validates correctness. Example: testing `f(x) == f(x)` instead of `f(x) == expected_value`.

2. **right-answer-wrong-work (slopodar)** — Tests where the assertion passes but via the wrong causal path. The test appears to verify behaviour X but actually only verifies behaviour Y which happens to produce the same result.

3. **Coverage gaps** — Functions, branches, or edge cases in `bin/triangulate` that are NOT tested but should be. Focus on:
   - Error paths (exceptions, early returns)
   - Boundary conditions (0, 1, max)
   - Functions not tested at all

4. **Bug documentation accuracy** — The tests claim to document 8 known bugs. For each:
   - Does the test actually demonstrate the bug?
   - Is the "EXPECTED" comment correct about what the fix should be?
   - Could the test pass even after the bug is fixed (making it a useless regression detector)?

5. **Test isolation** — Do tests depend on each other? Shared mutable state? Import side effects from loading `tri = load_triangulate()` at module level?

6. **Fixture quality** — Are `_make_finding()` and `_make_review_yaml()` correct? Could they mask bugs?

7. **Missing negative tests** — Are there cases where the tests only verify happy paths and don't verify that invalid inputs produce errors?

8. **Semantic hallucination in tests** — Test names or docstrings that claim to test one thing but actually test something else.

## Watchdog Taxonomy (classify every finding)

| ID | Category | Description |
|----|----------|-------------|
| WD-SH | Semantic Hallucination | Test names/docstrings that claim to verify behaviour the test does not actually check |
| WD-LRT | Looks Right Trap | Test follows correct pattern but operates on wrong data or asserts wrong property |
| WD-CB | Completeness Bias | Each test is correct in isolation but important cross-cutting concerns are untested |
| WD-DC | Dead Code | Test setup or assertions that are unreachable or have no effect |
| WD-TDF | Training Data Frequency | Testing patterns that reflect common examples rather than what this code actually needs |
| WD-PG | Paper Guardrail | Test claims to verify a constraint but the assertion doesn't actually enforce it |
| WD-PL | Phantom Ledger | Bug documentation claims don't match what the test actually demonstrates |

## Slopodar Patterns

- **right-answer-wrong-work**: Assertion passes but via wrong causal path
- **phantom-ledger**: Bug documentation ≠ actual test behaviour
- **shadow-validation**: Test covers easy cases, skips the critical path
- **paper-guardrail**: Test claims to verify a constraint but doesn't enforce it

## Required Output Format

Your review MUST contain two sections:

### Section 1: Narrative Report (human-readable)

Free-form markdown. Focus on the most important findings. This is the qualitative report.

### Section 2: Structured Findings (machine-readable)

A YAML block fenced with ```yaml and ```. This block MUST be parseable YAML.

```yaml
review:
  model: "<your model name>"
  date: "2026-03-09"
  branches:
    - "main"
  base_commit: "c1a43ce"
findings:
  - id: F-001
    branch: "main"
    file: "bin/test_triangulate.py"
    line: "<line range>"
    severity: <critical|high|medium|low>
    watchdog: <WD-XX|none>
    slopodar: <pattern-name|none>
    title: "<max 120 chars>"
    description: >
      <multi-line description>
    recommendation: "<what to fix>"
```

Rules:
- One entry per finding. Keep them atomic.
- severity: critical | high | medium | low
- watchdog: valid ID from taxonomy, or "none"
- slopodar: valid pattern name, or "none"
- Every field is required for every finding.

## Severity Guide for Test Reviews

| Level | Meaning | Examples |
|-------|---------|---------|
| critical | Test actively hides a defect / gives false confidence about safety | Tautological test on financial operation |
| high | Test cannot detect the bug it claims to document, or major coverage gap | Bug-doc test that passes after fix |
| medium | Test is weak or misleading but partially effective | Assertion checks side effect not primary outcome |
| low | Test quality issue, naming, minor gap | Unclear docstring, unused fixture |

## Code Under Test: bin/triangulate

```python
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6.0"]
# ///
"""
triangulate — Parse Darkcat Alley review files and compute triangulation metrics.

Reads structured YAML findings blocks from cross-model review files,
matches findings across reviews, computes convergence metrics, and
outputs both human-readable summaries and machine-readable YAML data.

Usage:
    triangulate summary <r1> [<r2>] [<r3>] [options]      # human-readable summary
    triangulate metrics <r1> [<r2>] [<r3>] [options]      # machine-readable YAML metrics
    triangulate convergence <r1> [<r2>] [<r3>] [options]  # convergence matrix
    triangulate export <r1> [<r2>] [<r3>] [options]       # export all data products
    triangulate parse <review_file>                        # parse + validate a single review

Options:
    --out <dir>        Output directory for export (default: data/alley/<run-id>)
    --run <id>         Run identifier (default: auto-generated from date)
    --match-threshold  Similarity threshold for matching findings (default: 0.6)

Supports 2 or 3 review files for all commands.

Backrefs: SD-318 (Darkcat Alley), SD-317 (QA sequencing), SD-309 (True North)
Process:  docs/internal/weaver/darkcat-alley.md
Instructions: docs/internal/weaver/darkcat-review-instructions.md
"""

import sys
import re
from datetime import datetime, timezone
from itertools import permutations
from pathlib import Path
from difflib import SequenceMatcher
from collections import Counter
from typing import Any

import yaml


# ── Constants ──────────────────────────────────────────────────

SEVERITY_ORDINAL = {"critical": 4, "high": 3, "medium": 2, "low": 1}
WATCHDOG_IDS = {"WD-SH", "WD-LRT", "WD-CB", "WD-DC", "WD-TDF", "WD-PG", "WD-PL", "none"}
VALID_SEVERITIES = {"critical", "high", "medium", "low"}


# ── YAML Extraction ────────────────────────────────────────────

def extract_yaml_block(text: str) -> dict | None:
    """Extract the structured YAML findings block from a markdown review file.

    Looks for a fenced YAML block containing a 'findings' key.
    Returns parsed YAML dict or None if not found.
    """
    # Match ```yaml ... ``` blocks
    pattern = r"```ya?ml\s*\n(.*?)```"
    matches = re.findall(pattern, text, re.DOTALL)

    for match in matches:
        try:
            parsed = yaml.safe_load(match)
            if isinstance(parsed, dict) and "findings" in parsed:
                return parsed
        except yaml.YAMLError:
            continue

    return None


def parse_review_file(filepath: str) -> dict:
    """Parse a review file and extract structured findings.

    Returns dict with 'review' metadata and 'findings' list.
    Raises ValueError if no valid YAML block found.
    """
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"Review file not found: {filepath}")

    text = path.read_text(encoding="utf-8")
    data = extract_yaml_block(text)

    if data is None:
        raise ValueError(
            f"No structured YAML findings block found in {filepath}. "
            f"Review must contain a fenced ```yaml block with a 'findings' key. "
            f"See docs/internal/weaver/darkcat-review-instructions.md"
        )

    return data


def validate_finding(finding: dict, source: str) -> list[str]:
    """Validate a single finding against the schema. Returns list of warnings."""
    warnings = []

    if not isinstance(finding, dict):
        warnings.append(f"{source}: finding is not a dict — got {type(finding).__name__}")
        return warnings

    required = {"id", "branch", "file", "line", "severity", "watchdog", "slopodar", "title", "description", "recommendation"}
    missing = required - set(finding.keys())
    if missing:
        warnings.append(f"{source}/{finding.get('id', '?')}: missing fields: {missing}")

    sev = finding.get("severity", "")
    if not isinstance(sev, str):
        warnings.append(f"{source}/{finding.get('id', '?')}: severity must be a string, got {type(sev).__name__}")
    elif sev not in VALID_SEVERITIES:
        warnings.append(f"{source}/{finding.get('id', '?')}: invalid severity '{sev}' — must be one of {VALID_SEVERITIES}")

    wd = finding.get("watchdog", "")
    if not isinstance(wd, str):
        warnings.append(f"{source}/{finding.get('id', '?')}: watchdog must be a string, got {type(wd).__name__}")
    elif wd not in WATCHDOG_IDS:
        warnings.append(f"{source}/{finding.get('id', '?')}: unknown watchdog category '{wd}' — expected one of {WATCHDOG_IDS}")

    # Type checks for string fields
    for field in ("title", "description", "file", "branch", "id"):
        val = finding.get(field)
        if val is not None and not isinstance(val, str):
            warnings.append(f"{source}/{finding.get('id', '?')}: '{field}' should be a string, got {type(val).__name__}")

    return warnings


def validate_review(data: dict, source: str) -> list[str]:
    """Validate an entire review's structure. Returns list of warnings."""
    warnings = []

    if "review" not in data:
        warnings.append(f"{source}: missing 'review' metadata block")
    else:
        review = data["review"]
        for field in ["model", "date", "branches", "base_commit"]:
            if field not in review:
                warnings.append(f"{source}: review metadata missing '{field}'")

    findings = data.get("findings", [])
    if not findings:
        warnings.append(f"{source}: no findings in structured block")

    for f in findings:
        warnings.extend(validate_finding(f, source))

    return warnings


# ── Finding Matching ───────────────────────────────────────────

def similarity(a: str, b: str) -> float:
    """Compute string similarity ratio between two strings."""
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def compute_pairwise_scores(
    all_findings: list[tuple[str, dict]],
    threshold: float,
) -> list[tuple[int, int, float]]:
    """Compute all pairwise similarity scores between findings from different reviews.

    Returns list of (i, j, score) tuples where score >= threshold,
    sorted by score descending (best matches first).
    """
    scores = []
    for i in range(len(all_findings)):
        rid_i, f_i = all_findings[i]
        for j in range(i + 1, len(all_findings)):
            rid_j, f_j = all_findings[j]
            # Only compare findings from different reviews
            if rid_i == rid_j:
                continue

            file_sim = similarity(f_i.get("file", ""), f_j.get("file", ""))
            title_sim = similarity(f_i.get("title", ""), f_j.get("title", ""))
            combined = 0.3 * file_sim + 0.7 * title_sim

            if combined >= threshold:
                scores.append((i, j, combined))

    # Sort by score descending — best matches consumed first
    scores.sort(key=lambda x: -x[2])
    return scores


def match_findings(
    reviews: dict[str, list[dict]],
    threshold: float = 0.6,
) -> list[dict]:
    """Match findings across reviews using max-weight bipartite-style matching.

    Uses pairwise scoring with greedy-best-first assignment. Compares all
    findings against all group members (not just seed) for group admission.

    Returns a list of matched finding groups, each containing:
    - matched_findings: dict mapping review_id -> finding
    - convergence: list of review IDs that found this
    - canonical_title: representative title
    - canonical_file: representative file
    - canonical_severity: highest severity across reviews
    - match_confidence: average pairwise similarity score within group
    """
    # Collect all findings with their source
    all_findings: list[tuple[str, dict]] = []
    for review_id, findings in reviews.items():
        for f in findings:
            all_findings.append((review_id, f))

    # Compute all pairwise scores above threshold
    scores = compute_pairwise_scores(all_findings, threshold)

    # Max-weight greedy assignment: consume best matches first
    # Each finding can be in exactly one group
    # Each group has at most one finding per review
    groups: list[dict] = []
    assigned: dict[int, int] = {}  # finding_index -> group_index

    for i, j, score in scores:
        rid_i = all_findings[i][0]
        rid_j = all_findings[j][0]

        gi = assigned.get(i)
        gj = assigned.get(j)

        if gi is not None and gj is not None:
            # Both already in groups — skip (no merging to keep it simple)
            continue
        elif gi is not None:
            # i is in a group, try to add j to it
            group = groups[gi]
            if rid_j not in group["matched_findings"]:
                # Check j against all existing group members (not just seed)
                avg_sim = _avg_similarity_to_group(all_findings[j][1], group, all_findings)
                if avg_sim >= threshold:
                    group["matched_findings"][rid_j] = all_findings[j][1]
                    group["convergence"].append(rid_j)
                    group["_scores"].append(score)
                    assigned[j] = gi
        elif gj is not None:
            # j is in a group, try to add i to it
            group = groups[gj]
            if rid_i not in group["matched_findings"]:
                avg_sim = _avg_similarity_to_group(all_findings[i][1], group, all_findings)
                if avg_sim >= threshold:
                    group["matched_findings"][rid_i] = all_findings[i][1]
                    group["convergence"].append(rid_i)
                    group["_scores"].append(score)
                    assigned[i] = gj
        else:
            # Neither in a group — create new group
            new_group = {
                "matched_findings": {rid_i: all_findings[i][1], rid_j: all_findings[j][1]},
                "convergence": [rid_i, rid_j],
                "_scores": [score],
            }
            group_idx = len(groups)
            groups.append(new_group)
            assigned[i] = group_idx
            assigned[j] = group_idx

    # Create singleton groups for unmatched findings
    for idx, (rid, finding) in enumerate(all_findings):
        if idx not in assigned:
            groups.append({
                "matched_findings": {rid: finding},
                "convergence": [rid],
                "_scores": [],
            })

    # Set canonical values and match confidence for all groups
    for group in groups:
        # Canonical = first finding in the group (by review ID order)
        first_rid = group["convergence"][0]
        first_finding = group["matched_findings"][first_rid]
        group["canonical_title"] = first_finding.get("title", "unknown")
        group["canonical_file"] = first_finding.get("file", "unknown")

        # Canonical severity = highest across all matched findings
        severities = [
            SEVERITY_ORDINAL.get(f.get("severity", "low"), 1)
            for f in group["matched_findings"].values()
        ]
        max_sev_ord = max(severities) if severities else 1
        rev_ordinal = {v: k for k, v in SEVERITY_ORDINAL.items()}
        group["canonical_severity"] = rev_ordinal.get(max_sev_ord, "low")

        # Match confidence = average of pairwise scores in this group
        if group["_scores"]:
            group["match_confidence"] = round(sum(group["_scores"]) / len(group["_scores"]), 4)
        else:
            group["match_confidence"] = None  # singleton — no match to score

        del group["_scores"]

    return groups


def _avg_similarity_to_group(
    finding: dict,
    group: dict,
    all_findings: list[tuple[str, dict]],
) -> float:
    """Compute average similarity of a finding to all existing members of a group."""
    sims = []
    for rid, existing_f in group["matched_findings"].items():
        file_sim = similarity(finding.get("file", ""), existing_f.get("file", ""))
        title_sim = similarity(finding.get("title", ""), existing_f.get("title", ""))
        combined = 0.3 * file_sim + 0.7 * title_sim
        sims.append(combined)
    return sum(sims) / len(sims) if sims else 0.0


# ── Metrics Computation ────────────────────────────────────────

def compute_metrics(
    groups: list[dict],
    review_ids: list[str],
    reviews_data: dict[str, dict],
) -> dict:
    """Compute all Darkcat Alley metrics from matched finding groups."""

    n_reviews = len(review_ids)
    total = len(groups)

    # Metric 1: Finding count by model
    finding_count = {}
    for rid in review_ids:
        model_name = reviews_data[rid].get("review", {}).get("model", rid)
        t = sum(1 for g in groups if rid in g["convergence"])
        u = sum(1 for g in groups if g["convergence"] == [rid])
        s2 = sum(1 for g in groups if rid in g["convergence"] and len(g["convergence"]) == 2)
        s3 = sum(1 for g in groups if rid in g["convergence"] and len(g["convergence"]) >= 3)
        finding_count[rid] = {
            "model": model_name,
            "total": t,
            "unique": u,
            "shared_2": s2,
            "shared_3": s3,
        }

    # Metric 2: Convergence rate
    converged_all = sum(1 for g in groups if len(g["convergence"]) == n_reviews)
    converged_2 = sum(1 for g in groups if len(g["convergence"]) == 2)
    single_model = sum(1 for g in groups if len(g["convergence"]) == 1)
    converged_2plus = converged_all + converged_2
    convergence_rate = {
        "total_unique_findings": total,
        "n_reviews": n_reviews,
        "converged_all": converged_all,
        "converged_2": converged_2,
        "single_model": single_model,
        "rate_all": round(converged_all / total, 4) if total else 0,
        "rate_2plus": round(converged_2plus / total, 4) if total else 0,
        "rate_single": round(single_model / total, 4) if total else 0,
    }

    # Metric 3: Marginal value — all permutations
    all_marginals = []
    for perm in permutations(review_ids):
        seen: set[int] = set()
        perm_marginal = []
        for rid in perm:
            new_unique = 0
            for idx, g in enumerate(groups):
                if rid in g["convergence"] and idx not in seen:
                    new_unique += 1
                    seen.add(idx)
            perm_marginal.append({
                "model": reviews_data[rid].get("review", {}).get("model", rid),
                "review_id": rid,
                "cumulative_unique": len(seen),
                "new_unique": new_unique,
            })
        all_marginals.append({"order": list(perm), "cumulative": perm_marginal})

    # Compute mean marginal value per position across all orderings
    n_perms = len(all_marginals)
    position_means = []
    for pos in range(n_reviews):
        mean_new = sum(m["cumulative"][pos]["new_unique"] for m in all_marginals) / n_perms
        mean_cum = sum(m["cumulative"][pos]["cumulative_unique"] for m in all_marginals) / n_perms
        position_means.append({
            "position": pos + 1,
            "mean_new_unique": round(mean_new, 2),
            "mean_cumulative": round(mean_cum, 2),
        })

    # Per-model mean marginal value (average new_unique across all positions this model appears)
    model_mean_marginal = {}
    for rid in review_ids:
        model_name = reviews_data[rid].get("review", {}).get("model", rid)
        new_uniques = []
        for m in all_marginals:
            for entry in m["cumulative"]:
                if entry["review_id"] == rid:
                    new_uniques.append(entry["new_unique"])
        model_mean_marginal[rid] = {
            "model": model_name,
            "mean_new_unique": round(sum(new_uniques) / len(new_uniques), 2) if new_uniques else 0,
        }

    marginal_value = {
        "dispatch_order": {"order": review_ids, "cumulative": all_marginals[0]["cumulative"] if all_marginals else []},
        "all_permutations": all_marginals,
        "position_means": position_means,
        "model_means": model_mean_marginal,
        "n_permutations": n_perms,
    }

    # Metric 4: Severity distribution by model
    severity_dist = {}
    for rid in review_ids:
        model_name = reviews_data[rid].get("review", {}).get("model", rid)
        counts = Counter()
        for g in groups:
            if rid in g["convergence"]:
                f = g["matched_findings"].get(rid)
                if f:
                    counts[f.get("severity", "low")] += 1
        severity_dist[rid] = {
            "model": model_name,
            **{s: counts.get(s, 0) for s in VALID_SEVERITIES},
        }

    # Metric 5: Watchdog category distribution
    watchdog_dist = {}
    for rid in review_ids:
        model_name = reviews_data[rid].get("review", {}).get("model", rid)
        counts = Counter()
        for g in groups:
            if rid in g["convergence"]:
                f = g["matched_findings"].get(rid)
                if f:
                    wd = f.get("watchdog", "none")
                    if wd != "none":
                        counts[wd] += 1
        watchdog_dist[rid] = {"model": model_name, "categories": dict(counts)}

    # Metric 6: Severity calibration (converged findings only)
    severity_calibration = []
    for g in groups:
        if len(g["convergence"]) >= 2:
            entry = {"finding": g["canonical_title"], "match_confidence": g.get("match_confidence")}
            severities_seen = {}
            for rid in g["convergence"]:
                f = g["matched_findings"].get(rid)
                if f:
                    sev = f.get("severity", "low")
                    severities_seen[rid] = sev
                    entry[f"severity_{rid}"] = sev
            ordinals = [SEVERITY_ORDINAL.get(s, 1) for s in severities_seen.values()]
            entry["agreement"] = len(set(ordinals)) == 1
            entry["max_delta"] = max(ordinals) - min(ordinals) if ordinals else 0
            severity_calibration.append(entry)

    # Metric 8: False positive rate — NOT YET ADJUDICATED
    # All findings default to "pending" — no claims about FP rate until human review
    fp_rate = {
        "status": "pending_adjudication",
        "note": "FP rate requires human verification of each finding. Values below are placeholders, not measurements.",
        "per_model": {},
    }
    for rid in review_ids:
        model_name = reviews_data[rid].get("review", {}).get("model", rid)
        t = sum(1 for g in groups if rid in g["convergence"])
        fp_rate["per_model"][rid] = {
            "model": model_name,
            "total_findings": t,
            "confirmed_true": None,
            "confirmed_false": None,
            "disputed": None,
            "fp_rate": None,
        }

    # Match diagnostics — report match quality
    converged_groups = [g for g in groups if len(g["convergence"]) >= 2]
    match_diagnostics = {
        "threshold": 0.6,
        "total_groups": len(groups),
        "converged_groups": len(converged_groups),
        "singleton_groups": len(groups) - len(converged_groups),
    }
    if converged_groups:
        confidences = [g["match_confidence"] for g in converged_groups if g["match_confidence"] is not None]
        if confidences:
            match_diagnostics["avg_confidence"] = round(sum(confidences) / len(confidences), 4)
            match_diagnostics["min_confidence"] = round(min(confidences), 4)
            match_diagnostics["max_confidence"] = round(max(confidences), 4)

    return {
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "finding_count": finding_count,
        "convergence_rate": convergence_rate,
        "marginal_value": marginal_value,
        "severity_distribution": severity_dist,
        "watchdog_distribution": watchdog_dist,
        "severity_calibration": severity_calibration,
        "false_positive_rate": fp_rate,
        "match_diagnostics": match_diagnostics,
    }


# ── Output Formatters ──────────────────────────────────────────

def format_summary(groups: list[dict], metrics: dict, review_ids: list[str], reviews_data: dict) -> str:
    """Format a human-readable summary of the triangulation."""
    lines = []
    n_reviews = len(review_ids)
    lines.append("=" * 72)
    lines.append("  DARKCAT ALLEY — TRIANGULATION SUMMARY")
    lines.append("=" * 72)
    lines.append("")

    # Models
    lines.append("REVIEWS:")
    for rid in review_ids:
        model = reviews_data[rid].get("review", {}).get("model", rid)
        n = metrics["finding_count"][rid]["total"]
        u = metrics["finding_count"][rid]["unique"]
        lines.append(f"  {rid}: {model} — {n} findings ({u} unique)")
    lines.append("")

    # Convergence
    cr = metrics["convergence_rate"]
    lines.append("CONVERGENCE:")
    lines.append(f"  Total unique findings: {cr['total_unique_findings']}")
    if n_reviews >= 3:
        lines.append(f"  All {n_reviews} models:          {cr['converged_all']} ({cr['rate_all']:.1%})")
    rate_2only = cr['rate_2plus'] - cr['rate_all']
    lines.append(f"  2 of {n_reviews} models:         {cr['converged_2']} ({rate_2only:.1%})")
    lines.append(f"  Single model only:     {cr['single_model']} ({cr['rate_single']:.1%})")
    lines.append("")

    # Match diagnostics
    md = metrics.get("match_diagnostics", {})
    if md.get("avg_confidence") is not None:
        lines.append("MATCH DIAGNOSTICS:")
        lines.append(f"  Threshold: {md.get('threshold', '?')}")
        lines.append(f"  Avg confidence: {md.get('avg_confidence', '?')}")
        lines.append(f"  Min confidence: {md.get('min_confidence', '?')}")
        lines.append(f"  Max confidence: {md.get('max_confidence', '?')}")
        lines.append("")

    # Marginal value (dispatch order)
    mv = metrics["marginal_value"]
    lines.append("MARGINAL VALUE (dispatch order):")
    for m in mv["dispatch_order"]["cumulative"]:
        lines.append(f"  {m['model']:20s}  +{m['new_unique']:2d} new  ({m['cumulative_unique']:2d} cumulative)")
    lines.append("")

    # Marginal value (mean across all orderings)
    lines.append(f"MARGINAL VALUE (mean across {mv['n_permutations']} orderings):")
    for pm in mv["position_means"]:
        lines.append(f"  Position {pm['position']}: +{pm['mean_new_unique']:.1f} new  ({pm['mean_cumulative']:.1f} cumulative)")
    lines.append("")

    lines.append("MODEL MEAN MARGINAL VALUE:")
    for rid in review_ids:
        mm = mv["model_means"][rid]
        lines.append(f"  {mm['model']:20s}  mean +{mm['mean_new_unique']:.1f} new per ordering")
    lines.append("")

    # Converged findings (highest priority)
    converged = [g for g in groups if len(g["convergence"]) >= 2]
    if converged:
        lines.append("CONVERGED FINDINGS (2+ models agree):")
        for g in sorted(converged, key=lambda x: (-len(x["convergence"]), -SEVERITY_ORDINAL.get(x["canonical_severity"], 0))):
            conv = ",".join(g["convergence"])
            conf = g.get("match_confidence")
            conf_str = f" (conf={conf:.2f})" if conf is not None else ""
            lines.append(f"  [{g['canonical_severity'].upper():8s}] {g['canonical_title']}")
            lines.append(f"           → {g['canonical_file']}  [{conv}]{conf_str}")
        lines.append("")

    # Single-model findings
    singles = [g for g in groups if len(g["convergence"]) == 1]
    if singles:
        lines.append("SINGLE-MODEL FINDINGS (unique to one reviewer):")
        for rid in review_ids:
            model = reviews_data[rid].get("review", {}).get("model", rid)
            rid_singles = [g for g in singles if g["convergence"] == [rid]]
            if rid_singles:
                lines.append(f"  {model}:")
                for g in rid_singles:
                    lines.append(f"    [{g['canonical_severity'].upper():8s}] {g['canonical_title']}")
        lines.append("")

    # Watchdog distribution
    lines.append("WATCHDOG CATEGORY COVERAGE:")
    all_cats = set()
    for rid in review_ids:
        all_cats.update(metrics["watchdog_distribution"][rid]["categories"].keys())
    if all_cats:
        header = f"  {'Category':8s}"
        for rid in review_ids:
            model = reviews_data[rid].get("review", {}).get("model", rid)[:12]
            header += f"  {model:>12s}"
        lines.append(header)
        for cat in sorted(all_cats):
            row = f"  {cat:8s}"
            for rid in review_ids:
                count = metrics["watchdog_distribution"][rid]["categories"].get(cat, 0)
                row += f"  {count:>12d}"
            lines.append(row)
    lines.append("")

    # Severity calibration
    if metrics["severity_calibration"]:
        lines.append("SEVERITY CALIBRATION (converged findings):")
        agree = sum(1 for s in metrics["severity_calibration"] if s["agreement"])
        total_conv = len(metrics["severity_calibration"])
        lines.append(f"  Agreement: {agree}/{total_conv} ({agree/total_conv:.0%})")
        disagreements = [s for s in metrics["severity_calibration"] if not s["agreement"]]
        if disagreements:
            lines.append("  Disagreements:")
            for d in disagreements:
                sevs = {k: v for k, v in d.items() if k.startswith("severity_")}
                lines.append(f"    {d['finding'][:60]}")
                lines.append(f"      {sevs}  (delta: {d['max_delta']})")
    lines.append("")

    # FP rate status
    fp = metrics.get("false_positive_rate", {})
    lines.append(f"FALSE POSITIVE RATE: {fp.get('status', 'unknown').upper()}")
    lines.append(f"  {fp.get('note', '')}")
    lines.append("")

    lines.append("=" * 72)
    lines.append(f"  Computed: {metrics['computed_at']}")
    lines.append("=" * 72)

    return "\n".join(lines)


def format_convergence_matrix(groups: list[dict], review_ids: list[str], reviews_data: dict) -> str:
    """Format a markdown convergence matrix."""
    lines = []
    lines.append("# Convergence Matrix")
    lines.append("")

    # Header
    header = "| Finding | Severity "
    for rid in review_ids:
        model = reviews_data[rid].get("review", {}).get("model", rid)[:10]
        header += f"| {model} "
    header += "| Converge | Confidence |"
    lines.append(header)

    sep = "|---------|----------"
    for _ in review_ids:
        sep += "|:---:"
    sep += "|----------|------------|"
    lines.append(sep)

    n_reviews = len(review_ids)
    for g in sorted(groups, key=lambda x: (-len(x["convergence"]), -SEVERITY_ORDINAL.get(x["canonical_severity"], 0))):
        row = f"| {g['canonical_title'][:50]} | {g['canonical_severity'].upper()} "
        for rid in review_ids:
            if rid in g["convergence"]:
                row += "| YES "
            else:
                row += "| — "
        conv_count = len(g["convergence"])
        conf = g.get("match_confidence")
        conf_str = f"{conf:.2f}" if conf is not None else "—"
        if conv_count == n_reviews:
            row += f"| **ALL {n_reviews}** | {conf_str} |"
        elif conv_count >= 2:
            row += f"| {'+'.join(g['convergence'])} | {conf_str} |"
        else:
            row += f"| {g['convergence'][0]} only | — |"
        lines.append(row)

    return "\n".join(lines)


# ── Export ─────────────────────────────────────────────────────

def export_all(
    groups: list[dict],
    metrics: dict,
    review_ids: list[str],
    reviews_data: dict[str, dict],
    out_dir: Path,
    run_id: str,
) -> None:
    """Export all data products to the output directory."""
    out_dir.mkdir(parents=True, exist_ok=True)

    # Metadata
    metadata = {
        "run_id": run_id,
        "computed_at": metrics["computed_at"],
        "reviews": {},
    }
    for rid in review_ids:
        rd = reviews_data[rid].get("review", {})
        metadata["reviews"][rid] = {
            "model": rd.get("model", "unknown"),
            "date": rd.get("date", "unknown"),
            "branches": rd.get("branches", []),
            "finding_count": len(reviews_data[rid].get("findings", [])),
        }
    write_yaml(out_dir / "metadata.yaml", metadata)

    # Per-review parsed findings
    for rid in review_ids:
        write_yaml(out_dir / f"{rid}.yaml", reviews_data[rid])

    # Convergence matrix
    convergence = []
    for g in groups:
        convergence.append({
            "title": g["canonical_title"],
            "file": g["canonical_file"],
            "severity": g["canonical_severity"],
            "convergence": g["convergence"],
            "convergence_count": len(g["convergence"]),
            "match_confidence": g.get("match_confidence"),
        })
    write_yaml(out_dir / "convergence.yaml", convergence)

    # All metrics
    write_yaml(out_dir / "metrics.yaml", metrics)

    # Union of findings (deduplicated) — include recommendation and line
    union = []
    for g in groups:
        entry = {
            "title": g["canonical_title"],
            "file": g["canonical_file"],
            "severity": g["canonical_severity"],
            "found_by": g["convergence"],
            "convergence_count": len(g["convergence"]),
            "match_confidence": g.get("match_confidence"),
            "details": {},
        }
        for rid, f in g["matched_findings"].items():
            entry["details"][rid] = {
                "id": f.get("id"),
                "severity": f.get("severity"),
                "watchdog": f.get("watchdog"),
                "slopodar": f.get("slopodar"),
                "line": f.get("line"),
                "description": f.get("description"),
                "recommendation": f.get("recommendation"),
            }
        union.append(entry)
    write_yaml(out_dir / "findings-union.yaml", union)

    print(f"Exported to {out_dir}/")
    print(f"  metadata.yaml       — run metadata")
    for rid in review_ids:
        print(f"  {rid}.yaml{' ' * (20 - len(rid))}— parsed findings")
    print(f"  convergence.yaml    — convergence matrix")
    print(f"  metrics.yaml        — all computed metrics")
    print(f"  findings-union.yaml — deduplicated union")


def write_yaml(path: Path, data: Any) -> None:
    """Write data to a YAML file with readable multi-line strings."""
    class MultilineDumper(yaml.SafeDumper):
        pass

    def str_representer(dumper: yaml.SafeDumper, data: str) -> Any:
        if "\n" in data or len(data) > 100:
            return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")
        return dumper.represent_scalar("tag:yaml.org,2002:str", data)

    MultilineDumper.add_representer(str, str_representer)

    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, Dumper=MultilineDumper, default_flow_style=False, sort_keys=False, allow_unicode=True, width=120)


# ── CLI ────────────────────────────────────────────────────────

def usage() -> None:
    """Print usage and exit."""
    print(__doc__)
    sys.exit(1)


def parse_cli_args(args: list[str]) -> tuple[list[str], dict[str, str]]:
    """Parse CLI args into positional file paths and named options.

    Separates --flag value pairs from positional arguments.
    Returns (file_paths, options_dict).
    """
    files = []
    options = {}
    i = 0
    while i < len(args):
        if args[i].startswith("--") and i + 1 < len(args):
            options[args[i]] = args[i + 1]
            i += 2
        else:
            files.append(args[i])
            i += 1
    return files, options


def cmd_parse(args: list[str]) -> None:
    """Parse and validate a single review file."""
    if len(args) < 1:
        print("Usage: triangulate parse <review_file>")
        sys.exit(1)

    filepath = args[0]
    try:
        data = parse_review_file(filepath)
    except (FileNotFoundError, ValueError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    warnings = validate_review(data, filepath)
    if warnings:
        print("WARNINGS:")
        for w in warnings:
            print(f"  ⚠ {w}")
        print()

    findings = data.get("findings", [])
    model = data.get("review", {}).get("model", "unknown")
    print(f"Model: {model}")
    print(f"Findings: {len(findings)}")
    for f in findings:
        sev = f.get("severity", "?").upper()
        title = f.get("title", "untitled")
        print(f"  [{sev:8s}] {title}")


def load_reviews(file_paths: list[str]) -> tuple[list[str], dict, dict]:
    """Load and validate 2+ review files. Returns (review_ids, reviews_data, raw_findings)."""
    if len(file_paths) < 2:
        print("ERROR: At least 2 review files required", file=sys.stderr)
        sys.exit(1)

    review_ids = [f"R{i+1}" for i in range(len(file_paths))]
    paths = dict(zip(review_ids, file_paths))
    reviews_data: dict[str, dict] = {}
    all_warnings: list[str] = []

    for rid, path in paths.items():
        try:
            data = parse_review_file(path)
            reviews_data[rid] = data
            all_warnings.extend(validate_review(data, f"{rid}:{path}"))
        except (FileNotFoundError, ValueError) as e:
            print(f"ERROR loading {rid}: {e}", file=sys.stderr)
            sys.exit(1)

    if all_warnings:
        print("VALIDATION WARNINGS:", file=sys.stderr)
        for w in all_warnings:
            print(f"  ⚠ {w}", file=sys.stderr)
        print(file=sys.stderr)

    reviews = {rid: data.get("findings", []) for rid, data in reviews_data.items()}
    return review_ids, reviews_data, reviews


def cmd_summary(args: list[str]) -> None:
    """Print human-readable summary."""
    files, options = parse_cli_args(args)
    if len(files) < 2:
        print("Usage: triangulate summary <r1> <r2> [<r3>] [--match-threshold <float>]")
        sys.exit(1)

    threshold = float(options.get("--match-threshold", "0.6"))
    review_ids, reviews_data, reviews = load_reviews(files)
    groups = match_findings(reviews, threshold)
    metrics = compute_metrics(groups, review_ids, reviews_data)
    print(format_summary(groups, metrics, review_ids, reviews_data))


def cmd_metrics(args: list[str]) -> None:
    """Output machine-readable YAML metrics."""
    files, options = parse_cli_args(args)
    if len(files) < 2:
        print("Usage: triangulate metrics <r1> <r2> [<r3>] [--match-threshold <float>]")
        sys.exit(1)

    threshold = float(options.get("--match-threshold", "0.6"))
    review_ids, reviews_data, reviews = load_reviews(files)
    groups = match_findings(reviews, threshold)
    metrics = compute_metrics(groups, review_ids, reviews_data)
    yaml.dump(metrics, sys.stdout, default_flow_style=False, sort_keys=False, allow_unicode=True, width=120)


def cmd_convergence(args: list[str]) -> None:
    """Output convergence matrix in markdown."""
    files, options = parse_cli_args(args)
    if len(files) < 2:
        print("Usage: triangulate convergence <r1> <r2> [<r3>] [--match-threshold <float>]")
        sys.exit(1)

    threshold = float(options.get("--match-threshold", "0.6"))
    review_ids, reviews_data, reviews = load_reviews(files)
    groups = match_findings(reviews, threshold)
    print(format_convergence_matrix(groups, review_ids, reviews_data))


def cmd_export(args: list[str]) -> None:
    """Export all data products."""
    files, options = parse_cli_args(args)
    if len(files) < 2:
        print("Usage: triangulate export <r1> <r2> [<r3>] [--out <dir>] [--run <id>]")
        sys.exit(1)

    out_dir_str = options.get("--out")
    run_id = options.get("--run", datetime.now(timezone.utc).strftime("run-%Y%m%d-%H%M%S"))
    threshold = float(options.get("--match-threshold", "0.6"))

    out_dir = Path(out_dir_str) if out_dir_str else Path("data/alley") / run_id

    review_ids, reviews_data, reviews = load_reviews(files)
    groups = match_findings(reviews, threshold)
    metrics = compute_metrics(groups, review_ids, reviews_data)
    export_all(groups, metrics, review_ids, reviews_data, out_dir, run_id)

    # Also print summary to stdout
    print()
    print(format_summary(groups, metrics, review_ids, reviews_data))


def main() -> None:
    """CLI entrypoint."""
    args = sys.argv[1:]

    if not args:
        usage()

    cmd = args[0]
    rest = args[1:]

    commands = {
        "summary": cmd_summary,
        "metrics": cmd_metrics,
        "convergence": cmd_convergence,
        "export": cmd_export,
        "parse": cmd_parse,
    }

    if cmd in commands:
        commands[cmd](rest)
    elif cmd in ("-h", "--help", "help"):
        usage()
    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        usage()


if __name__ == "__main__":
    main()
```

## Test File Under Review: bin/test_triangulate.py

```python
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
```

## Expected Output

Write your review to: `data/alley/20260309/test-review/test-review-gemini.md`
