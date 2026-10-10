"""Runs demand_model.ipynb from top to bottom and saves it with its outputs
(`npm run analytics:notebook`). Same results as `npm run analytics`, with the explanation."""

import sys
from pathlib import Path

import nbformat
from nbclient import NotebookClient

HERE = Path(__file__).resolve().parent
NOTEBOOK = HERE / "demand_model.ipynb"


def main() -> int:
    nb = nbformat.read(NOTEBOOK, as_version=4)
    print(f"Running {NOTEBOOK.name} (about 20 seconds)…")
    NotebookClient(
        nb,
        timeout=900,
        kernel_name="python3",
        resources={"metadata": {"path": str(HERE)}},
        # The kernel runs locally for this one notebook; its transport warnings are just noise
        extra_arguments=["--IPKernelApp.log_level=ERROR"],
    ).execute()
    # Keep the saved file stable between runs: no execution timestamps, and no memory
    # addresses in the plain-text fallback of formatted tables
    for cell in nb.cells:
        cell.get("metadata", {}).pop("execution", None)
        for output in cell.get("outputs", []):
            data = output.get("data", {})
            if "text/html" in data and str(data.get("text/plain", "")).startswith("<pandas."):
                data["text/plain"] = "(table)"

    nbformat.write(nb, NOTEBOOK)
    print(f"Saved {NOTEBOOK.relative_to(HERE.parent)} with its outputs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
