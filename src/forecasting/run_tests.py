"""Runs the forecast engine's tests (`npm run forecast:test`) and, unlike plain unittest,
always says *why* anything was skipped — usually the database test needing Docker or setup.

    python run_tests.py              # forecasting/tests, summary
    python run_tests.py -v           # every test by name
    python run_tests.py <tests dir>  # another suite, e.g. analytics/tests
"""

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main(argv: list[str]) -> int:
    verbosity = 2 if "-v" in argv or "--verbose" in argv else 1
    dirs = [a for a in argv if not a.startswith("-")]
    tests = Path(dirs[0]).resolve() if dirs else HERE / "tests"
    suite = unittest.defaultTestLoader.discover(str(tests), top_level_dir=str(tests.parent))
    result = unittest.TextTestRunner(verbosity=verbosity).run(suite)

    if result.skipped:
        reasons: dict[str, list[str]] = {}
        for test, reason in result.skipped:
            # A class skipped in setUpClass shows as "setUpClass (tests.test_db.SomeTest)"
            name = str(test).replace("setUpClass (", "").rstrip(")").split(" ")[-1]
            reasons.setdefault(reason, []).append(name.strip("()"))
        print("\nSkipped (these did not run):")
        for reason, names in reasons.items():
            print(f"  • {reason}")
            for n in names:
                print(f"      {n}")
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
