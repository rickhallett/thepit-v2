watch_officer: opencode
weave_mode: tight
register: quarterdeck
tempo: making-way
true_north: "hired = proof > claim"
bearing: "methodology review"
last_known_position: "none"

Section 1: Narrative Assessment

Challenge 1: Convergence as signal  
- Validity: valid concern  
- Severity: serious weakness  
- What’s needed: show that convergence exceeds what shared priors would predict. Use ablations: (a) same model, different prompts; (b) different models, same prompt; (c) shuffled or redacted diffs; and (d) synthetic controls with seeded defects. Report convergence relative to these baselines.  
- Salvage: salvageable as “convergence correlates with common vulnerability priors,” not as independent verification, unless new controls demonstrate independence.

Challenge 2: 74% single-model rate  
- Validity: valid concern  
- Severity: serious weakness  
- What’s needed: strict input equality (same diff slice, same context size, same instructions, same time budget), and repeated runs per model to estimate within-model variance. Compare to 3x same-model runs and to 1-model with 3x tokens.  
- Salvage: claim must be weakened to “single-model review may miss findings” until baselines are measured.

Challenge 3: Matching algorithm defensibility  
- Validity: valid concern  
- Severity: serious weakness  
- What’s needed: non-greedy matching with calibrated thresholds, a human-verified gold set for match quality, and reported false-merge / missed-merge rates. Sensitivity analysis on weights and thresholds.  
- Salvage: can be salvaged once match accuracy is measured; current metrics are unreliable.

Challenge 4: N=31 from N=1 codebase  
- Validity: valid concern  
- Severity: fatal flaw for general claims  
- What’s needed: multi-codebase evaluation (at least 5–10 codebases of varied provenance), with stratified sampling and confidence intervals on all headline metrics.  
- Salvage: current claims must be reframed as anecdotal; no generalisation.

Challenge 5: Human Delta  
- Validity: valid concern  
- Severity: serious weakness  
- What’s needed: human-first baseline (blind review before model outputs), counterbalanced order, and independent adjudication.  
- Salvage: can be salvaged as “human after-model delta,” not as human capability.

Challenge 6: Cost-benefit without costs  
- Validity: valid concern  
- Severity: serious weakness  
- What’s needed: explicit cost model (tokens, wall time, human verification time) and benefit model by severity-weighted risk. Include alternative baselines (single model with 3x tokens; 3x same-model runs; human-only).  
- Salvage: cannot claim cost-effectiveness until costs are measured.

Challenge 7: Self-referential validation  
- Validity: valid concern  
- Severity: fatal flaw for precision claims  
- What’s needed: independent human adjudication of all findings, reporting precision/recall with confidence intervals.  
- Salvage: drop FP rate claims until adjudicated; otherwise it is paper-guardrail by the team’s own taxonomy.

Additional methodological concerns  
- Order effects: review sequence can bias marginal-value curves; must randomize order and report variance.  
- Severity calibration: ordinal distances are not meaningful without inter-rater reliability metrics (e.g., weighted kappa).  
- Taxonomy anchoring: providing taxonomies can steer findings into predefined bins, inflating apparent coverage. Need a free-form pass or “other” analysis.  
- Confirmation bias in post-QA: if fixes are applied by the same team, post-QA findings may be suppressed by social/confirmation effects.  
- Lack of ground-truth defect set: without seeded defects or known issues, recall cannot be measured.

Section 2: Overall Verdict

1. Would it pass peer review as-is?  
No. It lacks baselines, match validity, independent adjudication, and adequate sample size. It would require a multi-codebase study, calibrated matching, human adjudication, and cost modeling.

2. Is the process worth continuing, or is it measurement theatre?  
Worth continuing as an engineering heuristic, but currently measurement theatre for any quantitative claims.

3. Single most important change  
Establish ground truth via independent human adjudication plus seeded defect controls, then re-run across multiple codebases.

Section 3: Structured Findings

```yaml
review:
  model: "codex52"
  date: "2026-03-09"
  branches:
    - "triangulation-methodology"
  base_commit: "unknown"

findings:
  - id: F-001
    branch: "triangulation-methodology"
    file: "docs/internal/weaver/darkcat-alley.md"
    line: "n/a"
    severity: critical
    watchdog: WD-PG
    slopodar: paper-guardrail
    title: "Claims rely on unverified matching accuracy"
    description: >
      The matching algorithm is greedy and uncalibrated, but all downstream
      metrics depend on its correctness. Without measured false-merge and
      missed-merge rates, convergence and uniqueness metrics are unreliable.
    recommendation: "Calibrate matching on a human-labeled gold set and report match error rates."

  - id: F-002
    branch: "triangulation-methodology"
    file: "docs/internal/weaver/darkcat-alley.md"
    line: "n/a"
    severity: critical
    watchdog: WD-PG
    slopodar: paper-guardrail
    title: "False positive rate claimed without adjudication"
    description: >
      The FP rate defaults all findings to confirmed true. This makes the
      precision chart and any quality claims invalid until independent human
      verification is completed.
    recommendation: "Require human adjudication of every finding before reporting FP/precision."

  - id: F-003
    branch: "triangulation-methodology"
    file: "docs/internal/weaver/darkcat-alley.md"
    line: "n/a"
    severity: high
    watchdog: WD-LRT
    slopodar: shadow-validation
    title: "Convergence treated as independent verification"
    description: >
      Convergence can reflect shared training priors rather than independent
      discovery. The current process lacks controls to distinguish these causes.
    recommendation: "Add baselines: same-model multi-run and prompt-variance controls."

  - id: F-004
    branch: "triangulation-methodology"
    file: "docs/internal/weaver/darkcat-alley.md"
    line: "n/a"
    severity: high
    watchdog: WD-CB
    slopodar: none
    title: "Single-model rate lacks baseline"
    description: >
      The 74% single-model rate is presented as evidence of model complementarity
      without comparison to repeated runs of the same model or larger token budgets.
    recommendation: "Run within-model variance baselines and report comparative rates."

  - id: F-005
    branch: "triangulation-methodology"
    file: "docs/internal/weaver/darkcat-alley.md"
    line: "n/a"
    severity: critical
    watchdog: WD-PG
    slopodar: stale-reference-propagation
    title: "General claims from N=1 codebase"
    description: >
      Claims about model blind spots and diminishing returns are drawn from a
      single codebase with 31 findings. This cannot support generalisation.
    recommendation: "Evaluate across multiple diverse codebases and report confidence intervals."

  - id: F-006
    branch: "triangulation-methodology"
    file: "docs/internal/weaver/darkcat-alley.md"
    line: "n/a"
    severity: high
    watchdog: WD-PL
    slopodar: phantom-ledger
    title: "Cost-benefit claims without cost model"
    description: >
      The methodology promises cost justification but does not model costs or
      severity-weighted benefits. This is benefit-only accounting.
    recommendation: "Include explicit cost model and compare to cheaper baselines."

  - id: F-007
    branch: "triangulation-methodology"
    file: "docs/internal/weaver/darkcat-alley.md"
    line: "n/a"
    severity: high
    watchdog: WD-PG
    slopodar: shadow-validation
    title: "Human delta is order-confounded"
    description: >
      Human review occurs after model outputs, priming the reviewer and inflating
      the apparent human delta. This measures residuals after models, not human capability.
    recommendation: "Add blind human-first baseline with counterbalanced order."

```
