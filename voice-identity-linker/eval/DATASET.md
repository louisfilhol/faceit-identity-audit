# Ground-truth evaluation protocol

The database can generate candidate pairs, but it cannot generate identity
ground truth: a Steam ID is an account, not a verified person. Never turn
account equality into a validation label unless the dataset was collected under
a protocol that guarantees one known subject per account.

## Collection target

Treat these as minimum development targets, not a promise of statistical power:

- at least 30 consenting, independently identified subjects;
- at least three demos from separate sessions per subject;
- multiple microphones, languages, network conditions, and speech durations;
- enough speech to produce several bounded embedding windows per subject; and
- both easy and hard impostor pairs, including similar language/channel groups.

Keep an audit record outside the voice model explaining how every opaque
`subject_id` was established. Do not put names or other direct identifiers in
the pair manifest.

## Label and split the manifest

Generate candidates from a populated database:

```bash
python cli.py generate-pairs \
  --output eval/pairs/reviewed.csv \
  --max-different 1000
```

For every usable row, fill these review fields:

- `subject_id_a` and `subject_id_b`: stable, opaque ground-truth subject IDs;
- `label`: `same` only when the subject IDs match, otherwise `different`;
- `split`: `development` or `test`; and
- `notes`: collection or label-audit context, without direct identifiers.

Leave uncertain rows as `review`. The tuning script ignores them and rejects a
row whose reviewed label contradicts its subject IDs.

Assign each subject to exactly one split before creating the final pair lists.
Use a pair only when both subjects belong to that same split. Never let clips,
accounts, or alternate accounts for one subject cross from development to test.
This is more important than randomly splitting rows, because rows that share a
speaker or clip are correlated.

## Select once, report once

Choose the threshold on development subjects:

```bash
python cli.py tune \
  --manifest eval/pairs/reviewed.csv \
  --split development
```

Lock that threshold, then report the held-out test split without changing it:

```bash
python cli.py tune \
  --manifest eval/pairs/reviewed.csv \
  --split test \
  --operating-threshold 0.53
```

Record the model version, VAD settings, threshold, uncertainty margin, subject
count, demo count, same/different pair counts, and FAR/FRR with uncertainty.
Also inspect results by language, microphone/channel, and clip-length bucket;
pooled performance can hide a failing subgroup.

The Wilson intervals printed by the script are descriptive pair-level
intervals. They do not account for repeated speakers or clips. A release claim
needs a larger speaker-disjoint evaluation, ideally with subject-level
bootstrap intervals. Likewise, the product's `VERDICT_MARGIN` is an operational
uncertainty band around the threshold, not a calibrated identity probability or
statistical confidence interval.

## Preprocessing changes

Do not compare or pool raw-audio and VAD embeddings. The manifest records the
preprocessing policy and speech-retention ratio; the tuning script warns about
mismatches. When the model, VAD, chunk size, or extraction pipeline changes,
re-embed the whole evaluation set and regenerate scores before re-tuning.

