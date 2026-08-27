# SPDX-License-Identifier: AGPL-3.0-only
#!/usr/bin/env python3
"""CS2 Voice Identity Linker — CLI.

Commands:
  ingest   <dem|dir>      Extract + embed a demo (or all demos in a dir).
  embed-all                Embed any already-extracted WAVs not yet in the DB.
  verify   <steamA> <steamB>   Compare same-speaker evidence for two accounts.
  match    <steamid>       Find all accounts matching this voice.
  cluster  <demo_id>       Group voices in a demo by similarity.
  players                  List known players + consent status.
  consent  <steamid> --grant/--revoke  Set consent.
  tune                     Sweep threshold over eval/pairs, report EER.
  generate-pairs           Build a reviewable pair manifest from the DB.
  vad-impact               Compare raw and Silero-VAD pair scores.
"""

from __future__ import annotations

import logging
from pathlib import Path

import config
import typer
from core import embedder, extractor, linking, store
from core.pipeline import demo_fingerprint, ingest_demo
from core.pipeline import embedder_ok as pipeline_embedder_ok
from rich.console import Console
from rich.table import Table

app = typer.Typer(add_completion=False, help=__doc__)
console = Console()
err = Console(stderr=True)


def _setup_logging(verbose: bool):
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


@app.callback()
def main(verbose: bool = False):
    _setup_logging(verbose)


# --- ingest -----------------------------------------------------------------


@app.command()
def ingest(
    path: Path = typer.Argument(..., help=".dem file or directory of .dem files"),
    source: str = typer.Option("local", help="Source label: local|upload"),
    only: str | None = typer.Option(
        None,
        "--only",
        help="comma-separated steamids to embed; everyone else is skipped",
    ),
):
    """Extract + embed a demo (or every .dem in a directory)."""
    config.ensure_dirs()
    dem_files = sorted(path.glob("*.dem")) if path.is_dir() else [path]
    if not dem_files:
        err.print(f"[red]no .dem files found at {path}")
        raise typer.Exit(1)

    only_set = set(s.strip() for s in only.split(",")) if only else None
    for dem in dem_files:
        console.rule(f"[cyan]{dem.name}")
        demo_id, _result, stats = ingest_demo(
            dem,
            source=source,
            only_steamids=only_set,
        )
        table = Table(title=f"demo #{demo_id} ingest", show_lines=False)
        table.add_column("player")
        table.add_column("steamid")
        table.add_column("status")
        table.add_column("audio", justify="right")
        for s in stats:
            table.add_row(
                str(s.get("nickname") or "-"),
                s["steamid"],
                s["status"],
                f"{s.get('audio_sec', 0):.1f}s",
            )
        console.print(table)
        embedded = sum(1 for s in stats if s["status"] == "embedded")
        console.print(f"[green]{embedded} embedded, {len(stats)} players total.")


# --- verify / match / cluster ----------------------------------------------


@app.command()
def scan(
    demo: Path = typer.Argument(..., help=".dem file to scan"),
    steamid: str = typer.Argument(..., help="target player's steamid64 in this demo"),
    ref: str | None = typer.Option(
        config.REF_STEAMID or None,
        "--ref",
        help="reference player's steamid64 (already in the DB). Defaults to REF_STEAMID in .env",
    ),
    threshold: float = typer.Option(config.DEFAULT_THRESHOLD, help="Cosine threshold"),
    persist: bool = typer.Option(
        True,
        "--store/--no-store",
        help="persist the scanned player's embedding in the DB (audit trail)",
    ),
):
    """Fast one-player check: is <steamid> in this demo the same voice as <ref>?

    Extracts the demo, embeds ONLY the targeted player, and compares against
    the reference player's stored voiceprint. Nothing else in the demo is
    embedded, so a scan takes ~extraction + one embedding.
    """
    config.ensure_dirs()

    # --- reference must already have a voiceprint ---------------------------
    if not ref:
        err.print(
            "[red]no reference player: pass --ref <steamid> or set REF_STEAMID in .env"
        )
        raise typer.Exit(2)
    ref_vec = store.mean_vector(ref)
    ref_player = store.get_player(ref)
    if ref_vec is None:
        err.print(
            f"[red]{ref} has no embedding yet. Ingest a demo containing them "
            "first, e.g. reference_player = <steamid>"
        )
        raise typer.Exit(1)

    # --- extract the demo, find the targeted player --------------------------
    if not demo.exists():
        err.print(f"[red]demo not found: {demo}")
        raise typer.Exit(1)
    console.rule(f"[cyan]{demo.name}")
    console.print(f"extracting {demo.name} ...")
    result = extractor.extract(demo)
    clip = next((c for c in result.clips if c.steamid == steamid), None)
    if clip is None:
        err.print(f"[red]{steamid} not found in this demo.[/] Players present:")
        for c in sorted(result.clips, key=lambda c: c.duration_sec, reverse=True):
            err.print(f"  {c.nickname or '-'}  {c.steamid}  ({c.duration_sec:.1f}s)")
        raise typer.Exit(1)

    # --- embed only that player ---------------------------------------------
    ok, reason = pipeline_embedder_ok(clip.duration_sec)
    if not ok:
        err.print(f"[red]cannot verify {clip.nickname or steamid}: {reason}")
        raise typer.Exit(1)
    console.print(
        f"embedding {clip.nickname or steamid} ({clip.duration_sec:.1f}s of voice) ..."
    )
    embedded = embedder.embed_file_detailed(clip.path)
    vec = embedded.vector
    used_sec = embedded.speech_seconds

    # --- compare + optionally persist ----------------------------------------
    score = embedder.cosine(vec, ref_vec)
    if persist:
        demo_id = store.add_demo(
            "local", str(demo.resolve()), fingerprint=demo_fingerprint(demo)
        )
        store.upsert_player(steamid=steamid, nickname=clip.nickname)
        already_stored = any(
            item.demo_id == demo_id for item in store.embeddings_for(steamid)
        )
        if not already_stored:
            for vector, chunk_sec in zip(
                embedded.chunk_vectors, embedded.chunk_seconds, strict=True
            ):
                raw_chunk_sec = (
                    embedded.raw_seconds * chunk_sec / embedded.speech_seconds
                    if embedded.speech_seconds
                    else 0.0
                )
                store.add_embedding(
                    steamid=steamid,
                    demo_id=demo_id,
                    vector=vector,
                    clip_count=1,
                    audio_sec=chunk_sec,
                    preprocessing=embedded.preprocessing,
                    raw_audio_sec=raw_chunk_sec,
                    speech_ratio=embedded.speech_ratio,
                )

    ref_name = ref_player.nickname if ref_player else ref
    console.print()
    console.print(f"  {ref_name} ({ref})  vs  {clip.nickname or steamid} ({steamid})")
    distribution = (
        linking.is_same_person(ref, steamid, threshold=threshold) if persist else None
    )
    if distribution is not None:
        color = (
            "green"
            if distribution.verdict == "same"
            else "red"
            if distribution.verdict == "different"
            else "yellow"
        )
        console.print(
            f"  median demo-pair score: [{color}]{distribution.score:.4f}[/] "
            f"({distribution.pair_count} demo pair(s), verdict agreement "
            f"{distribution.agreement:.0%}) "
            f"→ [bold {color}]{distribution.verdict.upper()}[/]"
        )
        for reason in distribution.reasons:
            console.print(f"  [dim]• {reason}[/]")
    else:
        console.print(
            f"  cosine similarity: [yellow]{score:.4f}[/] (threshold {threshold}) "
            "→ [bold yellow]INCONCLUSIVE[/]"
        )
        console.print(
            "  [dim]• a single target clip cannot support a definitive speaker verdict[/]"
        )
    console.print(
        f"  [dim]{used_sec:.0f}s speech used; {embedded.speech_ratio:.0%} retained "
        f"by {embedded.preprocessing}[/]"
    )


@app.command()
def verify(
    steamid_a: str = typer.Argument(...),
    steamid_b: str = typer.Argument(...),
    threshold: float = typer.Option(config.DEFAULT_THRESHOLD, help="Cosine threshold"),
):
    """Compare same-speaker evidence for two accounts."""
    res = linking.is_same_person(steamid_a, steamid_b, threshold=threshold)
    if res is None:
        err.print("[red]one or both players have no embedding yet.")
        raise typer.Exit(1)
    color = (
        "green"
        if res.verdict == "same"
        else "red"
        if res.verdict == "different"
        else "yellow"
    )
    console.print(
        f"median demo-pair score: [{color}]{res.score:.4f}[/] "
        f"(mean-vector {res.mean_score:.4f}, threshold {res.threshold}, "
        f"band {res.band_low:.3f}–{res.band_high:.3f}) → "
        f"[bold {color}]{res.verdict.upper()}[/]"
    )
    console.print(
        f"windows: {res.clip_count_a} × {res.clip_count_b} "
        f"= {res.window_pair_count} comparisons; "
        f"demos: {res.demo_count_a} × {res.demo_count_b}; "
        f"{res.pair_count} equally weighted demo pairs; "
        f"range {res.score_min:.3f}–{res.score_max:.3f}; "
        f"P10–P90 {res.score_p10:.3f}–{res.score_p90:.3f}; "
        f"verdict agreement {res.agreement:.0%}; "
        f"same-support {res.same_pair_fraction:.0%}; evidence {res.evidence_quality}"
    )
    for reason in res.reasons:
        console.print(f"[dim]• {reason}[/]")


@app.command()
def match(
    steamid: str = typer.Argument(...),
    k: int = typer.Option(10, help="top-k results"),
    threshold: float = typer.Option(config.DEFAULT_THRESHOLD),
):
    """Find all accounts whose voice matches this player."""
    results = linking.find_matches_for_player(steamid, k=k, threshold=threshold)
    if not results:
        err.print(f"[red]no embedding for {steamid} (or no other players).")
        raise typer.Exit(1)
    table = Table(title=f"matches for {steamid}")
    table.add_column("rank")
    table.add_column("player")
    table.add_column("steamid")
    table.add_column("score", justify="right")
    table.add_column("verdict")
    for i, r in enumerate(results, 1):
        evidence = linking.is_same_person(steamid, r.steamid, threshold=threshold)
        verdict = evidence.verdict if evidence else "inconclusive"
        shown_score = evidence.score if evidence else r.score
        color = (
            "green"
            if verdict == "same"
            else "red"
            if verdict == "different"
            else "yellow"
        )
        table.add_row(
            str(i),
            str(r.nickname or "-"),
            r.steamid,
            f"[{color}]{shown_score:.4f}[/]",
            verdict.upper(),
        )
    console.print(table)


@app.command()
def cluster(
    demo_id: int = typer.Argument(...),
    threshold: float = typer.Option(config.DEFAULT_THRESHOLD),
):
    """Group voices in a demo by similarity (ignores Steam IDs)."""
    groups = linking.cluster_demo(demo_id, threshold=threshold)
    console.print(f"[cyan]{len(groups)} voice group(s) in demo #{demo_id}:[/]")
    for i, g in enumerate(groups, 1):
        names = []
        for sid in g:
            p = store.get_player(sid)
            names.append(f"{p.nickname or sid} ({sid})" if p else sid)
        console.print(f"  group {i}: {', '.join(names)}")


# --- players / consent ------------------------------------------------------


@app.command()
def players():
    """List known players."""
    table = Table(title="players")
    table.add_column("nickname")
    table.add_column("steamid")
    table.add_column("consent")
    table.add_column("clips", justify="right")
    for p in store.all_players():
        embs = store.embeddings_for(p.steamid)
        secs = sum(e.audio_sec for e in embs)
        table.add_row(
            str(p.nickname or "-"),
            p.steamid,
            "yes" if p.consent else "[dim]no[/]",
            f"{len(embs)} ({secs:.0f}s)",
        )
    console.print(table)


@app.command()
def consent(
    steamid: str = typer.Argument(...),
    grant: bool = typer.Option(False, "--grant", help="grant consent"),
    revoke: bool = typer.Option(False, "--revoke", help="revoke consent"),
    basis: str = typer.Option("explicit", help="lawful basis note"),
):
    """Set or revoke a player's consent."""
    if grant == revoke:
        err.print("[red]pass exactly one of --grant / --revoke")
        raise typer.Exit(2)
    store.set_consent(steamid, granted=grant, basis=basis)
    console.print(f"[green]consent {'granted' if grant else 'revoked'} for {steamid}")


# --- tune -------------------------------------------------------------------


@app.command()
def tune(
    pairs_dir: Path = typer.Option(Path("eval/pairs"), help="labeled pairs dir"),
    manifest: Path | None = typer.Option(
        None, help="reviewed CSV from generate-pairs (uses stored scores)"
    ),
    split: str | None = typer.Option(
        None, help="manifest split to evaluate, e.g. development or test"
    ),
    operating_threshold: float | None = typer.Option(
        None,
        "--operating-threshold",
        help="locked threshold for FAR/FRR reporting (default: configured threshold)",
    ),
):
    """Sweep threshold over labeled pairs, report EER."""
    from eval.tune_threshold import sweep

    sweep(
        pairs_dir,
        manifest=manifest,
        split=split,
        operating_threshold=operating_threshold,
    )


@app.command("generate-pairs")
def generate_pairs(
    output: Path = typer.Option(
        Path("eval/pairs/db_pairs.csv"), help="reviewable CSV output"
    ),
    max_different: int = typer.Option(500, min=0),
    seed: int = typer.Option(42),
    assume_account_labels: bool = typer.Option(
        False,
        "--assume-account-labels",
        help="dangerous: auto-label different SteamIDs as different people",
    ),
):
    """Generate reviewable clip pairs from the populated embedding DB."""
    from eval.generate_db_pairs import generate

    result = generate(
        config.DB_PATH,
        output,
        max_different=max_different,
        seed=seed,
        assume_account_labels=assume_account_labels,
    )
    console.print(
        f"wrote [cyan]{result['same_candidates']}[/] same-account and "
        f"[cyan]{result['different_candidates']}[/] cross-account candidates "
        f"to [bold]{result['output']}[/]"
    )
    if not assume_account_labels:
        console.print(
            "[yellow]Rows are labeled 'review'. Change verified rows to 'same' "
            "or 'different' before running tune --manifest.[/]"
        )


@app.command("vad-impact")
def vad_impact(
    pairs_dir: Path = typer.Option(Path("eval/pairs"), help="labeled path pairs"),
    output: Path | None = typer.Option(None, help="optional per-pair CSV output"),
):
    """Compare raw-audio and Silero-VAD scores on labeled path pairs."""
    from eval.compare_vad import compare

    compare(pairs_dir, output)


if __name__ == "__main__":
    app()
