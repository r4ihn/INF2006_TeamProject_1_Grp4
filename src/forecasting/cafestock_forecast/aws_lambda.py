"""The nightly forecast as an AWS Lambda function (Task 10).

An EventBridge rule calls ``handler`` every night. For each café it does what
``npm run forecast:publish`` does on a laptop: load the café's history, score LightGBM
against the 14-day average on recent weeks, keep the better one, and save the run for the
manager's Forecast page. The same code runs locally with ``npm run lambda:invoke``.

Settings (environment variables; the CloudFormation template sets them in AWS):

  DATABASE_URL            postgresql://… (local). In AWS instead:
  DB_SECRET_ARN           Secrets Manager secret with "username" and "password" (RDS makes one)
  DB_HOST, DB_PORT, DB_NAME   where the database is (default port 5432, name "cafestock")
  DB_SSL                  off (default) | require | verify-full (RDS: verify-full)
  DB_SSL_ROOT_CERT        CA bundle for verify-full (default: rds-global-bundle.pem in the package)
  CAFES                   "all" (default: every café with active items) or "slug-a,slug-b"
  MODEL_S3_URI            s3://bucket/models/lgbm-v1/model.txt (model.json is read next to it)
  MODEL_PATH              a local model file, when MODEL_S3_URI isn't set
  EVAL_WEEKS              recent weeks the candidates are scored on (default 8)
  MIN_MINUTES_BETWEEN_RUNS  skip a café published this recently (default 60) — EventBridge and
                          Lambda retries can deliver the same night twice
  METRICS_NAMESPACE       CloudWatch namespace for the job's metrics (default CafeStock/Forecast)

Events (JSON sent by EventBridge, or typed into the Lambda console's Test tab):

  the EventBridge schedule   forecast every café
  {"orgs": ["demo-cafe"]}    only these cafés
  {"dryRun": true}           decide and report, save nothing
  {"force": true}            publish even if a café was published in the last hour
  {"selfTest": true}         no database: forecast the demand snapshot packaged with the
                             function (Task 8b's data) with the model from S3 — the numbers
                             should equal the laptop's
  {"fail": true}             fail on purpose, to check the alarm e-mail

The handler returns a summary. If any café fails it raises ``ForecastJobError`` after the
other cafés are done, so Lambda counts an error and the CloudWatch alarm e-mails the team.
Every step is logged as one JSON line; metrics use CloudWatch's embedded metric format (a
log line CloudWatch turns into metrics), so no extra AWS call — or network route — is needed.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import os
import re
import ssl
import sys
import time
import traceback
from collections import Counter
from pathlib import Path, PurePosixPath
from urllib.parse import quote

from .engine import ItemInput
from .publish import DEFAULT_MODEL, REPO_ROOT, _describe, decide, publish

PACKAGE_ROOT = Path(__file__).resolve().parent.parent  # /var/task in Lambda
SNAPSHOT = "demand_2025-03-23.csv"
MODEL_CACHE = Path("/tmp/cafestock-model")  # Lambda's only writable folder; kept while warm
MIN_MS_PER_CAFE = 60_000  # don't start a café with less than a minute of the time limit left


class ForecastJobError(Exception):
    """The job (or one of its cafés) failed. ``summary`` says what happened to each café."""

    def __init__(self, message: str, summary: dict | None = None):
        super().__init__(message)
        self.summary = summary or {"ok": False, "message": message, "results": []}


# ─── Logging and metrics ─────────────────────────────────────────────────────


def log(event: str, level: str = "INFO", **fields) -> None:
    """One JSON line per step: CloudWatch Logs Insights can filter and chart the fields."""
    print(json.dumps({"level": level, "event": event, **fields}, default=str, ensure_ascii=False), flush=True)


def metrics(namespace: str, dimensions: dict[str, str], values: dict[str, tuple[float, str]]) -> None:
    """Writes metrics in CloudWatch's embedded metric format (a structured log line)."""
    present = {k: v for k, v in values.items() if v[0] is not None}
    record = {
        "_aws": {
            "Timestamp": int(time.time() * 1000),
            "CloudWatchMetrics": [
                {
                    "Namespace": namespace,
                    "Dimensions": [list(dimensions)],
                    "Metrics": [{"Name": k, "Unit": unit} for k, (_, unit) in present.items()],
                }
            ],
        },
        **dimensions,
        **{k: v for k, (v, _) in present.items()},
    }
    print(json.dumps(record), flush=True)


# ─── AWS services (replaced by fakes in the tests) ───────────────────────────


class AwsServices:
    """boto3 clients, created on first use and reused while the Lambda stays warm."""

    def __init__(self):
        self._clients = {}

    def _client(self, name):
        if name not in self._clients:
            import boto3  # part of the Lambda Python runtime; not needed locally

            self._clients[name] = boto3.client(name)
        return self._clients[name]

    def s3(self):
        return self._client("s3")

    def secret(self, arn: str) -> dict:
        value = self._client("secretsmanager").get_secret_value(SecretId=arn)
        return json.loads(value["SecretString"])


_SERVICES = AwsServices()


# ─── Settings ────────────────────────────────────────────────────────────────


def database_url(env, services) -> str:
    """The database address: credentials from Secrets Manager in AWS, DATABASE_URL locally."""
    arn = env.get("DB_SECRET_ARN")
    if arn:
        secret = services.secret(arn)
        host = env.get("DB_HOST") or secret.get("host")
        if not host:
            raise ForecastJobError("DB_HOST isn't set and the database secret has no host.")
        port = env.get("DB_PORT") or secret.get("port") or 5432
        name = env.get("DB_NAME") or secret.get("dbname") or "cafestock"
        user = quote(str(secret["username"]), safe="")
        password = quote(str(secret["password"]), safe="")
        return f"postgresql://{user}:{password}@{host}:{port}/{name}"
    if env.get("DATABASE_URL"):
        return env["DATABASE_URL"]
    raise ForecastJobError(
        "No database configured: set DB_SECRET_ARN and DB_HOST (AWS) or DATABASE_URL (local)."
    )


def ssl_context(env) -> ssl.SSLContext | None:
    """How to encrypt the database connection. RDS uses verify-full with its CA bundle."""
    mode = (env.get("DB_SSL") or "off").strip().lower()
    if mode in ("off", "disable"):
        return None
    if mode == "require":  # encrypted, but the server's certificate isn't checked
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    if mode == "verify-full":
        ca = Path(env.get("DB_SSL_ROOT_CERT") or PACKAGE_ROOT / "rds-global-bundle.pem")
        if not ca.is_file():
            raise ForecastJobError(f"DB_SSL=verify-full needs a CA bundle, but {ca} doesn't exist.")
        return ssl.create_default_context(cafile=str(ca))
    raise ForecastJobError(f"DB_SSL must be off, require or verify-full (got {mode!r}).")


def resolve_model(env, services, *, cache_dir: Path = MODEL_CACHE) -> tuple[Path, str | None]:
    """Where the LightGBM model file is: downloaded from S3 (cached per version), or local.

    Returns (path, problem). When the download fails the path doesn't exist, so the run falls
    back to the baseline — tonight's forecast still happens — and ``problem`` says why."""
    uri = env.get("MODEL_S3_URI")
    if not uri:
        return Path(env.get("MODEL_PATH") or DEFAULT_MODEL), None
    unavailable = cache_dir / "unavailable" / "model.txt"
    match = re.fullmatch(r"s3://([^/]+)/(.+)", uri.strip())
    if not match:
        return unavailable, f"MODEL_S3_URI must look like s3://bucket/path/model.txt (got {uri!r})."
    bucket, key = match.groups()
    tag = PurePosixPath(key).parent.name or "model"  # models/lgbm-v1/model.txt → lgbm-v1
    try:
        s3 = services.s3()
        etag = s3.head_object(Bucket=bucket, Key=key)["ETag"].strip('"')
        target = cache_dir / etag / tag / "model.txt"
        cached = target.exists()
        if not cached:
            target.parent.mkdir(parents=True, exist_ok=True)
            part = target.with_name("model.txt.part")
            s3.download_file(bucket, key, str(part))
            part.replace(target)
            meta_key = str(PurePosixPath(key).with_name("model.json"))
            try:
                s3.download_file(bucket, meta_key, str(target.with_name("model.json")))
            except Exception:  # noqa: BLE001 — optional: without it the folder name is the tag
                log("model.no_metadata", level="WARNING", source=f"s3://{bucket}/{meta_key}")
        log("model.ready", source=uri, version=etag, cached=cached)
        return target, None
    except Exception as err:  # noqa: BLE001
        problem = f"Couldn't download the model from {uri} ({_describe(err)}), so the baseline ran."
        log("model.unavailable", level="WARNING", problem=problem)
        return unavailable, problem


# ─── The job ─────────────────────────────────────────────────────────────────


def lock_key(org_id: str) -> int:
    """A PostgreSQL advisory-lock number for one café (two runs never write it at once)."""
    digest = hashlib.sha256(f"cafestock-forecast:{org_id}".encode()).digest()
    return int.from_bytes(digest[:8], "big", signed=True)


def cafe_slugs(conn, setting: str) -> list[str]:
    """ "all" → every café with at least one active item; otherwise the listed slugs."""
    if setting.strip().lower() in ("", "all"):
        rows = conn.run(
            """SELECT o.slug FROM organizations o
               WHERE EXISTS (SELECT 1 FROM items i WHERE i.org_id = o.id AND i.is_active)
               ORDER BY o.slug"""
        )
        return [r[0] for r in rows]
    return [s.strip() for s in setting.split(",") if s.strip()]


def _summarise(slug: str, outcome, *, dry_run: bool, problem: str | None) -> dict:
    run = outcome.run
    statuses = Counter(r.recommendation.status for r in run.items)
    return {
        "org": slug,
        "status": "dry-run" if dry_run else "published",
        "runId": outcome.run_id,
        "forecastFrom": run.as_of.isoformat(),
        "model": run.model_tag,
        "maseModel": round(outcome.model.error.mase, 4)
        if outcome.model and outcome.model.error.mase is not None
        else None,
        "maseBaseline": round(outcome.baseline.error.mase, 4)
        if outcome.baseline.error.mase is not None
        else None,
        "items": len(run.items),
        "toOrder": statuses["URGENT"] + statuses["REORDER"],
        "urgent": statuses["URGENT"],
        "modelProblem": problem or outcome.model_problem,
    }


def _run_cafe(conn, slug: str, *, env, event, model_path: Path, model_uri, problem) -> dict:
    dry_run = bool(event.get("dryRun"))
    rows = conn.run("SELECT id::text FROM organizations WHERE slug = :s", s=slug)
    if not rows:
        return {"org": slug, "status": "failed", "reason": f"No café with the slug '{slug}'."}
    org_id = rows[0][0]
    key = lock_key(org_id)
    if not conn.run("SELECT pg_try_advisory_lock(:k)", k=key)[0][0]:
        return {"org": slug, "status": "skipped", "reason": "another forecast for this café is running"}
    try:
        window = int(env.get("MIN_MINUTES_BETWEEN_RUNS") or 60)
        if not dry_run and not event.get("force") and window > 0:
            recent = conn.run(
                """SELECT started_at FROM forecast_runs
                   WHERE org_id = CAST(:o AS uuid) AND status = 'SUCCEEDED'
                     AND started_at > now() - make_interval(mins => :m)
                   ORDER BY started_at DESC LIMIT 1""",
                o=org_id,
                m=window,
            )
            if recent:
                at = recent[0][0].astimezone(dt.timezone.utc).strftime("%H:%M UTC")
                return {
                    "org": slug,
                    "status": "skipped",
                    "reason": f"already published at {at} (within {window} min); "
                    'send {"force": true} to run it again',
                }
        _, outcome = publish(
            conn,
            slug,
            dry_run=dry_run,
            model_path=model_path,
            model_uri=model_uri,
            eval_weeks=int(env.get("EVAL_WEEKS") or 8),
        )
        return _summarise(slug, outcome, dry_run=dry_run, problem=problem)
    finally:
        conn.run("SELECT pg_advisory_unlock(:k)", k=key)


def _remaining_ms(context) -> int:
    get = getattr(context, "get_remaining_time_in_millis", None)
    return get() if get else 15 * 60_000


def run(event, context, *, env, services=None) -> dict:
    """The whole nightly job. ``handler`` calls this with the real environment."""
    started = time.monotonic()
    event = event if isinstance(event, dict) else {}
    services = services or _SERVICES
    namespace = env.get("METRICS_NAMESPACE") or "CafeStock/Forecast"

    if event.get("fail"):
        log("job.test_failure", level="ERROR")
        raise ForecastJobError(
            'Test failure requested (event {"fail": true}) — this checks the alarm e-mail.'
        )
    if event.get("selfTest"):
        return self_test(env, services, started=started)

    trigger = "schedule" if event.get("source") in ("aws.events", "aws.scheduler") else "manual"
    log("job.started", trigger=trigger, request=getattr(context, "aws_request_id", None))
    model_path, problem = resolve_model(env, services)
    model_uri = env.get("MODEL_S3_URI") if problem is None and env.get("MODEL_S3_URI") else None

    from .db import connect

    url = database_url(env, services)
    try:
        conn = connect(url, ssl_context=ssl_context(env))
    except ForecastJobError:
        raise
    except Exception as err:  # noqa: BLE001
        log("job.no_database", level="ERROR", error=_describe(err))
        raise ForecastJobError(f"Can't reach the database: {_describe(err)}") from err

    results: list[dict] = []
    try:
        slugs = event.get("orgs") or cafe_slugs(conn, env.get("CAFES") or "all")
        for slug in slugs:
            left = _remaining_ms(context)
            result_trace = None
            if left < MIN_MS_PER_CAFE:
                result = {
                    "org": slug,
                    "status": "failed",
                    "reason": f"not started: only {left // 1000} s of the time limit left",
                }
            else:
                try:
                    result = _run_cafe(
                        conn, slug, env=env, event=event,
                        model_path=model_path, model_uri=model_uri, problem=problem,
                    )
                except Exception as err:  # noqa: BLE001 — one café must not stop the others
                    result = {"org": slug, "status": "failed", "reason": _describe(err)}
                    result_trace = traceback.format_exc(limit=5)
                else:
                    result_trace = None
            if result["status"] == "failed":
                log("cafe.failed", level="ERROR", **result, trace=result_trace)
            else:
                log(f"cafe.{result['status']}", **result)
            if result["status"] == "published":
                metrics(namespace, {"Cafe": slug}, {
                    "ItemsToOrder": (result["toOrder"], "Count"),
                    "UrgentItems": (result["urgent"], "Count"),
                    "ModelMASE": (result["maseModel"], "None"),
                    "BaselineMASE": (result["maseBaseline"], "None"),
                    "UsedMLModel": (1 if result["model"].startswith("lgbm") else 0, "Count"),
                })
            results.append(result)
    finally:
        conn.close()

    counts = Counter(r["status"] for r in results)
    published = counts["published"] + counts["dry-run"]
    failed = counts["failed"]
    seconds = round(time.monotonic() - started, 2)
    metrics(namespace, {}, {
        "CafesPublished": (counts["published"], "Count"),
        "CafesSkipped": (counts["skipped"], "Count"),
        "CafesFailed": (failed, "Count"),
        "DurationSeconds": (seconds, "Seconds"),
    })
    verb = "Dry run for" if event.get("dryRun") else "Forecast published for"
    summary = {
        "ok": failed == 0,
        "message": f"{verb} {published} café{'' if published == 1 else 's'} "
        f"({counts['skipped']} skipped, {failed} failed).",
        "trigger": trigger,
        "durationSeconds": seconds,
        "results": results,
    }
    if published == 0 and counts["skipped"] and not failed:
        first = next(r for r in results if r["status"] == "skipped")
        summary["message"] = (
            f"Nothing published: {counts['skipped']} café{'' if counts['skipped'] == 1 else 's'} "
            f"skipped ({first['org']}: {first['reason']})."
        )
    if failed:
        reasons = "; ".join(f"{r['org']}: {r['reason']}" for r in results if r["status"] == "failed")
        summary["message"] = f"{failed} of {len(results)} cafés failed — {reasons}"
        log("job.finished", level="ERROR", **summary)
        raise ForecastJobError(summary["message"], summary)
    log("job.finished", **summary)
    return summary


# ─── Self-test: no database needed ───────────────────────────────────────────


def _selftest_files() -> tuple[Path, Path]:
    packaged = PACKAGE_ROOT / "selftest"  # the Lambda package (npm run lambda:build)
    if (packaged / SNAPSHOT).is_file():
        return packaged / SNAPSHOT, packaged / "ingredients.csv"
    return REPO_ROOT / "analytics" / "snapshots" / SNAPSHOT, REPO_ROOT / "data" / "ingredients.csv"


def self_test(env, services, *, started: float) -> dict:
    """Forecasts the packaged demand snapshot exactly as a nightly run would, without a
    database — proof that the package, LightGBM and the model in S3 work in Lambda."""
    from .snapshot import read

    snapshot_path, ingredients_path = _selftest_files()
    series = read(snapshot_path)
    with open(ingredients_path, encoding="utf-8", newline="") as f:
        lead = {r["ingredient_name"]: int(r["lead_time_days"]) for r in csv.DictReader(f)}
    as_of = max(s.first_date + dt.timedelta(days=len(s.values)) for s in series.values())
    items = [
        ItemInput(
            item_id=name, name=name, unit=s.unit, on_hand=0.0,
            lead_time_days=lead.get(name), spoilage_cap=None,
            history=s.values, history_start=s.first_date,
        )
        for name, s in sorted(series.items())
    ]
    model_path, problem = resolve_model(env, services)
    outcome = decide(items, as_of=as_of, model_path=model_path, eval_weeks=int(env.get("EVAL_WEEKS") or 8))

    base = outcome.baseline.error.mase
    if outcome.model is not None:
        mase = outcome.model.error.mase
        message = (
            f"Self-test passed: LightGBM ({outcome.model.model_tag}) {mase:.3f} vs 14-day average "
            f"{base:.3f} → used {outcome.run.model_tag}."
        )
    else:
        mase = None
        message = f"Self-test passed: 14-day average {base:.3f}; LightGBM not used — {problem or outcome.model_problem}"
    result = {
        "ok": True,
        "mode": "self-test",
        "forecastFrom": as_of.isoformat(),
        "items": len(items),
        "model": outcome.run.model_tag,
        "maseModel": round(mase, 4) if mase is not None else None,
        "maseBaseline": round(base, 4),
        "modelSource": env.get("MODEL_S3_URI") or str(model_path),
        "message": message,
        "nextSevenDays": [
            {"item": r.item.name, "unit": r.item.unit, "total": round(sum(d.predicted for d in r.forecast), 1)}
            for r in outcome.run.items
        ],
        "python": sys.version.split()[0],
        "durationSeconds": round(time.monotonic() - started, 2),
    }
    log("selftest.finished", **result)
    return result


# ─── Entry points ────────────────────────────────────────────────────────────


def handler(event, context):
    """What AWS Lambda calls (Handler: cafestock_forecast.aws_lambda.handler)."""
    return run(event, context, env=dict(os.environ))


def main(argv: list[str] | None = None) -> int:
    """`npm run lambda:invoke` — runs the handler here, as Lambda would."""
    p = argparse.ArgumentParser(prog="npm run lambda:invoke --", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--event", type=Path, help="a JSON event file (default: the nightly schedule's)")
    p.add_argument("--self-test", action="store_true", help='send {"selfTest": true}')
    p.add_argument("--dry-run", action="store_true", help="add dryRun: save nothing")
    p.add_argument("--force", action="store_true", help="add force: ignore the one-hour guard")
    p.add_argument("--org", action="append", help="only this café (repeatable)")
    p.add_argument("--quiet", action="store_true", help="print only the result, not the log lines")
    args = p.parse_args(argv)

    if args.event:
        path = args.event
        if not path.is_absolute():  # relative to where `npm run` was typed, not forecasting/
            path = Path(os.environ.get("INIT_CWD") or os.getcwd()) / path
        event = json.loads(path.read_text(encoding="utf-8"))
    else:
        event = json.loads((Path(__file__).resolve().parents[1] / "lambda" / "events" / "scheduled.json")
                           .read_text(encoding="utf-8"))
    if args.self_test:
        event = {"selfTest": True}
    if args.dry_run:
        event["dryRun"] = True
    if args.force:
        event["force"] = True
    if args.org:
        event["orgs"] = args.org

    class LocalContext:
        aws_request_id = "local"

        @staticmethod
        def get_remaining_time_in_millis():
            return 5 * 60_000  # the same 5-minute limit as the deployed function

    env = dict(os.environ)
    env.setdefault("DATABASE_URL", "postgresql://cafestock:cafestock@localhost:5433/cafestock")
    stdout = sys.stdout
    if args.quiet:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")  # noqa: SIM115
    try:
        result = run(event, LocalContext(), env=env)
        code = 0
    except ForecastJobError as err:
        result, code = {**err.summary, "error": str(err)}, 1
    finally:
        if args.quiet:
            sys.stdout.close()
            sys.stdout = stdout
    print("\n── Result (what Lambda would return) ──")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
