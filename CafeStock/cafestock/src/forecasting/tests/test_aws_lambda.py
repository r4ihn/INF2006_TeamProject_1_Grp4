"""The nightly forecast job as AWS Lambda runs it (Task 10).

Database tests use the test database (skipped with a reason when it isn't there). AWS services
are replaced by small fakes, so no AWS account or boto3 is needed to run these.
"""

import contextlib
import datetime as dt
import io
import json
import os
import ssl
import tempfile
import unittest
from pathlib import Path

from tests.dbtest import TEST_URL, add_demand, add_item, connect_or_skip, drop_orgs, make_org

START = dt.date(2025, 1, 6)  # a Monday
WEEKLY = [10, 10, 10, 10, 10, 20, 30]
SCHEDULED = {
    "version": "0",
    "id": "53dc4d37-cffa-4f76-80c9-8b7d4a4d2eaa",
    "detail-type": "Scheduled Event",
    "source": "aws.events",
    "time": "2026-09-27T18:00:00Z",
    "resources": ["arn:aws:events:us-east-1:123456789012:rule/cafestock-nightly-forecast"],
    "detail": {},
}


class FakeContext:
    """What Lambda passes as `context` — only the parts the handler uses."""

    def __init__(self, remaining_ms=300_000):
        self.remaining_ms = remaining_ms
        self.aws_request_id = "req-test"

    def get_remaining_time_in_millis(self):
        return self.remaining_ms


def run_job(event, *, env=None, context=None, services=None):
    """Runs the handler, capturing its log lines. Returns (result or exception, log records)."""
    from cafestock_forecast import aws_lambda

    env = {"DATABASE_URL": TEST_URL, "MODEL_PATH": "/nonexistent/model.txt", **(env or {})}
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        try:
            result = aws_lambda.run(event, context or FakeContext(), env=env, services=services)
        except aws_lambda.ForecastJobError as err:
            result = err
    logs = [json.loads(line) for line in out.getvalue().splitlines() if line.startswith("{")]
    return result, logs


class NightlyJobTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.conn = connect_or_skip()

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def setUp(self):
        self.org, self.slug = make_org(self.conn, "Lambda Test Café")
        self.milk = add_item(self.conn, self.org, "Fresh milk", on_hand=40, lead=1, cap=500)
        demand = [v + (w % 3) * 2 for w in range(10) for v in WEEKLY]
        add_demand(self.conn, self.org, self.milk, START, demand)
        self.empty, self.empty_slug = make_org(self.conn, "No Items Café")
        self.orgs = [self.org, self.empty]

    def tearDown(self):
        drop_orgs(self.conn, self.orgs)

    def runs(self, org):
        return self.conn.run(
            "SELECT status::text, model_tag FROM forecast_runs WHERE org_id = CAST(:o AS uuid)",
            o=org,
        )

    def test_a_scheduled_run_publishes_and_says_what_it_did(self):
        result, logs = run_job({**SCHEDULED, "orgs": [self.slug]})

        self.assertTrue(result["ok"])
        self.assertEqual(result["message"], "Forecast published for 1 café (0 skipped, 0 failed).")
        [cafe] = result["results"]
        self.assertEqual(cafe["org"], self.slug)
        self.assertEqual(cafe["status"], "published")
        self.assertEqual(cafe["model"], "baseline-ma14")  # no model file here → baseline
        self.assertEqual(cafe["items"], 1)
        self.assertEqual(self.runs(self.org), [["SUCCEEDED", "baseline-ma14"]])
        self.assertEqual(cafe["runId"], self.conn.run(
            "SELECT id::text FROM forecast_runs WHERE org_id = CAST(:o AS uuid)", o=self.org
        )[0][0])
        self.assertIn("job.finished", [line.get("event") for line in logs])

    def test_it_writes_cloudwatch_metrics_as_log_lines(self):
        _, logs = run_job({**SCHEDULED, "orgs": [self.slug]})
        cafe = [line for line in logs if line.get("Cafe") == self.slug and "_aws" in line]
        self.assertEqual(len(cafe), 1)
        spec = cafe[0]["_aws"]["CloudWatchMetrics"][0]
        self.assertEqual(spec["Namespace"], "CafeStock/Forecast")
        self.assertEqual(spec["Dimensions"], [["Cafe"]])
        names = {m["Name"] for m in spec["Metrics"]}
        # no model here, so there's no ModelMASE to report
        self.assertEqual(names, {"ItemsToOrder", "UrgentItems", "BaselineMASE", "UsedMLModel"})
        self.assertEqual(cafe[0]["UsedMLModel"], 0)
        job = [line for line in logs if "_aws" in line and "Cafe" not in line]
        self.assertEqual(job[0]["CafesPublished"], 1)
        self.assertEqual(job[0]["CafesFailed"], 0)

    def test_a_repeat_within_the_hour_is_skipped_unless_forced(self):
        run_job({**SCHEDULED, "orgs": [self.slug]})
        again, _ = run_job({**SCHEDULED, "orgs": [self.slug]})
        self.assertTrue(again["ok"])
        self.assertEqual(again["results"][0]["status"], "skipped")
        self.assertIn("already published", again["results"][0]["reason"])
        self.assertTrue(again["message"].startswith("Nothing published: 1 café skipped"))
        self.assertEqual(len(self.runs(self.org)), 1)

        forced, _ = run_job({"orgs": [self.slug], "force": True})
        self.assertEqual(forced["results"][0]["status"], "published")
        self.assertEqual(len(self.runs(self.org)), 2)

    def test_dry_run_saves_nothing(self):
        result, _ = run_job({"orgs": [self.slug], "dryRun": True})
        self.assertEqual(result["results"][0]["status"], "dry-run")
        self.assertEqual(self.runs(self.org), [])

    def test_one_cafe_failing_does_not_stop_the_others_but_fails_the_job(self):
        err, logs = run_job({**SCHEDULED, "orgs": [self.empty_slug, self.slug]})

        from cafestock_forecast.aws_lambda import ForecastJobError

        self.assertIsInstance(err, ForecastJobError)
        self.assertIn("1 of 2 cafés failed", str(err))
        statuses = {r["org"]: r["status"] for r in err.summary["results"]}
        self.assertEqual(statuses, {self.empty_slug: "failed", self.slug: "published"})
        self.assertEqual(self.runs(self.org), [["SUCCEEDED", "baseline-ma14"]])
        self.assertIn("cafe.failed", [line.get("event") for line in logs])

    def test_a_cafe_already_being_forecast_is_skipped(self):
        from cafestock_forecast.aws_lambda import lock_key
        from cafestock_forecast.db import connect

        other = connect(TEST_URL)
        try:
            other.run("SELECT pg_advisory_lock(:k)", k=lock_key(self.org))
            result, _ = run_job({"orgs": [self.slug]})
        finally:
            other.close()
        self.assertEqual(result["results"][0]["status"], "skipped")
        self.assertIn("another forecast", result["results"][0]["reason"])
        self.assertEqual(self.runs(self.org), [])

    def test_all_means_every_cafe_with_active_items(self):
        from cafestock_forecast.aws_lambda import cafe_slugs

        slugs = cafe_slugs(self.conn, "all")
        self.assertIn(self.slug, slugs)
        self.assertNotIn(self.empty_slug, slugs)
        self.assertEqual(cafe_slugs(self.conn, " b-cafe, a-cafe "), ["b-cafe", "a-cafe"])

    def test_it_stops_before_running_out_of_time(self):
        err, _ = run_job({"orgs": [self.slug]}, context=FakeContext(remaining_ms=20_000))
        self.assertEqual(err.summary["results"][0]["status"], "failed")
        self.assertIn("time", err.summary["results"][0]["reason"])
        self.assertEqual(self.runs(self.org), [])


class FakeS3:
    def __init__(self, etag='"abc"', fail=None, has_meta=True):
        self.etag, self.fail, self.has_meta = etag, fail, has_meta
        self.downloads = []

    def head_object(self, Bucket, Key):
        if self.fail:
            raise self.fail
        return {"ETag": self.etag}

    def download_file(self, Bucket, Key, Filename):
        if Key.endswith("model.json") and not self.has_meta:
            raise FileNotFoundError(Key)
        self.downloads.append((Bucket, Key))
        Path(Filename).write_text(f"{Bucket}/{Key}", encoding="utf-8")


class Services:
    def __init__(self, s3=None, secret=None):
        self._s3, self._secret = s3, secret

    def s3(self):
        return self._s3

    def secret(self, arn):
        return self._secret


class ModelFromS3Test(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def resolve(self, s3, uri="s3://cafestock-artifacts/models/lgbm-v1/model.txt"):
        from cafestock_forecast.aws_lambda import resolve_model

        with contextlib.redirect_stdout(io.StringIO()):
            return resolve_model({"MODEL_S3_URI": uri}, Services(s3=s3), cache_dir=Path(self.tmp.name))

    def test_downloads_the_model_and_its_metadata_once_per_version(self):
        s3 = FakeS3()
        path, problem = self.resolve(s3)
        self.assertIsNone(problem)
        self.assertEqual(path.name, "model.txt")
        self.assertEqual(path.parent.name, "lgbm-v1")  # the folder name is the model tag
        self.assertEqual(path.read_text(encoding="utf-8"), "cafestock-artifacts/models/lgbm-v1/model.txt")
        self.assertTrue((path.parent / "model.json").exists())
        self.assertEqual(len(s3.downloads), 2)

        again, _ = self.resolve(s3)
        self.assertEqual(again, path)
        self.assertEqual(len(s3.downloads), 2)  # cached

        s3.etag = '"new"'  # a new model uploaded under the same name
        newer, _ = self.resolve(s3)
        self.assertNotEqual(newer, path)
        self.assertEqual(len(s3.downloads), 4)

    def test_a_download_problem_falls_back_to_the_baseline_with_the_reason(self):
        path, problem = self.resolve(FakeS3(fail=PermissionError("AccessDenied")))
        self.assertFalse(path.exists())
        self.assertIn("Couldn't download the model from s3://cafestock-artifacts/models/lgbm-v1/model.txt", problem)
        self.assertIn("AccessDenied", problem)

    def test_a_bad_uri_is_explained(self):
        path, problem = self.resolve(FakeS3(), uri="cafestock-artifacts/model.txt")
        self.assertIn("MODEL_S3_URI must look like s3://bucket/path/model.txt", problem)

    def test_without_s3_the_local_model_path_is_used(self):
        from cafestock_forecast.aws_lambda import resolve_model

        path, problem = resolve_model({"MODEL_PATH": "/x/lgbm-v1/model.txt"}, Services())
        self.assertEqual(path, Path("/x/lgbm-v1/model.txt"))
        self.assertIsNone(problem)


class DatabaseSettingsTest(unittest.TestCase):
    def test_credentials_come_from_the_secret_and_the_address_from_settings(self):
        from cafestock_forecast.aws_lambda import database_url

        secret = {"username": "cafestock", "password": "p@ss/w:rd#1"}
        url = database_url(
            {"DB_SECRET_ARN": "arn:secret", "DB_HOST": "db.abc.rds.amazonaws.com", "DB_NAME": "cafestock"},
            Services(secret=secret),
        )
        self.assertEqual(url, "postgresql://cafestock:p%40ss%2Fw%3Ard%231@db.abc.rds.amazonaws.com:5432/cafestock")

    def test_the_secret_can_also_hold_the_address(self):
        from cafestock_forecast.aws_lambda import database_url

        secret = {"username": "u", "password": "p", "host": "h", "port": 5433, "dbname": "d"}
        self.assertEqual(database_url({"DB_SECRET_ARN": "arn"}, Services(secret=secret)), "postgresql://u:p@h:5433/d")

    def test_database_url_is_used_when_there_is_no_secret(self):
        from cafestock_forecast.aws_lambda import database_url

        self.assertEqual(database_url({"DATABASE_URL": "postgresql://a@b/c"}, Services()), "postgresql://a@b/c")

    def test_no_database_settings_is_a_clear_error(self):
        from cafestock_forecast.aws_lambda import ForecastJobError, database_url

        with self.assertRaises(ForecastJobError) as caught:
            database_url({}, Services())
        self.assertIn("No database configured", str(caught.exception))

    def test_ssl_modes(self):
        from cafestock_forecast.aws_lambda import ssl_context

        self.assertIsNone(ssl_context({}))
        self.assertIsNone(ssl_context({"DB_SSL": "off"}))
        loose = ssl_context({"DB_SSL": "require"})
        self.assertEqual(loose.verify_mode, ssl.CERT_NONE)
        self.assertFalse(loose.check_hostname)

        missing = Path(tempfile.gettempdir()) / "cafestock-no-such-bundle.pem"
        with self.assertRaises(Exception) as caught:
            ssl_context({"DB_SSL": "verify-full", "DB_SSL_ROOT_CERT": str(missing)})
        self.assertIn(str(missing), str(caught.exception))  # \ on Windows, / elsewhere

        ca = Path(ssl.get_default_verify_paths().cafile or "")
        if ca.is_file():
            strict = ssl_context({"DB_SSL": "verify-full", "DB_SSL_ROOT_CERT": str(ca)})
            self.assertEqual(strict.verify_mode, ssl.CERT_REQUIRED)
            self.assertTrue(strict.check_hostname)

        with self.assertRaises(Exception):
            ssl_context({"DB_SSL": "maybe"})


class SelfTestAndFailTest(unittest.TestCase):
    def test_self_test_forecasts_the_bundled_snapshot_without_a_database(self):
        from cafestock_forecast import aws_lambda

        with contextlib.redirect_stdout(io.StringIO()):
            result = aws_lambda.run(
                {"selfTest": True}, FakeContext(), env={"MODEL_PATH": "/nonexistent/model.txt"}
            )
        self.assertTrue(result["ok"])
        self.assertEqual(result["mode"], "self-test")
        self.assertEqual(result["forecastFrom"], "2025-03-24")
        self.assertEqual(result["items"], 8)
        self.assertEqual(result["model"], "baseline-ma14")
        self.assertAlmostEqual(result["maseBaseline"], 1.126, places=3)
        self.assertIn("LightGBM not used", result["message"])
        milk = next(i for i in result["nextSevenDays"] if i["item"] == "Fresh milk")
        self.assertEqual(milk["unit"], "ml")
        self.assertGreater(milk["total"], 5000)

    def test_self_test_with_the_model_matches_the_laptop(self):
        try:
            import lightgbm  # noqa: F401
        except ImportError:
            self.skipTest("LightGBM not installed — run `npm run analytics:setup`")
        from cafestock_forecast import aws_lambda
        from cafestock_forecast.publish import DEFAULT_MODEL

        with contextlib.redirect_stdout(io.StringIO()):
            result = aws_lambda.run({"selfTest": True}, FakeContext(), env={"MODEL_PATH": str(DEFAULT_MODEL)})
        self.assertEqual(result["model"], "lgbm-v1")
        self.assertAlmostEqual(result["maseModel"], 1.088, places=3)
        self.assertAlmostEqual(result["maseBaseline"], 1.126, places=3)
        self.assertIn("LightGBM (lgbm-v1) 1.088 vs 14-day average 1.126", result["message"])

    def test_a_requested_failure_raises_so_the_alarm_can_be_tested(self):
        from cafestock_forecast import aws_lambda

        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(aws_lambda.ForecastJobError) as caught:
                aws_lambda.run({"fail": True}, FakeContext(), env={})
        self.assertIn("Test failure requested", str(caught.exception))

    def test_the_lambda_entry_point_reads_the_real_environment(self):
        from cafestock_forecast import aws_lambda

        old = dict(os.environ)
        try:
            os.environ["MODEL_PATH"] = "/nonexistent/model.txt"
            with contextlib.redirect_stdout(io.StringIO()):
                result = aws_lambda.handler({"selfTest": True}, FakeContext())
        finally:
            os.environ.clear()
            os.environ.update(old)
        self.assertTrue(result["ok"])


class TemplateMatchesPackageTest(unittest.TestCase):
    """infra/forecast.yaml and the package builder must agree, or the deploy breaks."""

    ROOT = Path(__file__).resolve().parents[2]

    def test_runtime_handler_and_package_name_line_up(self):
        import importlib.util
        import re

        template = (self.ROOT / "infra" / "forecast.yaml").read_text(encoding="utf-8")
        spec = importlib.util.spec_from_file_location("build", self.ROOT / "forecasting" / "lambda" / "build.py")
        build = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(build)

        self.assertIn(f"Runtime: python{build.PYTHON}", template)
        handler = re.search(r"Handler: (\S+)", template).group(1)
        module, func = handler.rsplit(".", 1)
        self.assertEqual(module, "cafestock_forecast.aws_lambda")
        from cafestock_forecast import aws_lambda

        self.assertTrue(callable(getattr(aws_lambda, func)))
        pattern = re.search(r"AllowedPattern: '(\^lambda/forecast-lambda-[^']+)'", template).group(1)
        self.assertRegex("lambda/forecast-lambda-5420217be533.zip", pattern)


if __name__ == "__main__":
    unittest.main()
