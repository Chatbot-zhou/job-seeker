from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run(label: str, command: list[str]) -> None:
    print(f"\n[validate] {label}", flush=True)
    print("$ " + " ".join(command), flush=True)
    completed = subprocess.run(command, cwd=ROOT, check=False)
    if completed.returncode != 0:
        raise SystemExit(f"{label} failed with exit code {completed.returncode}")


def main() -> int:
    node = shutil.which("node")
    git = shutil.which("git")
    if not node:
        raise SystemExit("node was not found; install Node.js and retry")
    if not git:
        raise SystemExit("git was not found; install Git and retry")

    checks = [
        ("Python tests", [sys.executable, "-m", "pytest", "-q"]),
        ("userscript policy tests", [node, "--test", "--test-reporter=tap", "tests/userscript_policy.test.cjs"]),
        ("userscript syntax", [node, "--check", "web_script.js"]),
        ("project self-check", [sys.executable, "scripts/self_check.py"]),
        ("Python dependency consistency", [sys.executable, "-m", "pip", "check"]),
        ("Git whitespace and conflict markers", [git, "diff", "--check"]),
    ]
    for label, command in checks:
        run(label, command)
    print("\n[validate] all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
