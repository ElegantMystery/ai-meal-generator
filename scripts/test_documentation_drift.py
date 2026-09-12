"""Exercise documentation-check failures without depending on the CI runner PATH."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
CHECK = ROOT / "scripts/check_documentation_drift.sh"
BASH = shutil.which("bash")


class DocumentationDriftTest(unittest.TestCase):
    def test_missing_ripgrep_reports_dependency_instead_of_missing_endpoint(self):
        with tempfile.TemporaryDirectory() as empty_path:
            result = subprocess.run(
                [BASH, str(CHECK)],
                cwd=ROOT,
                env={**os.environ, "PATH": empty_path},
                capture_output=True,
                text=True,
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ripgrep (rg) is required", result.stderr)
        self.assertNotIn("missing endpoint", result.stderr)

    def test_missing_endpoint_still_fails_when_ripgrep_is_available(self):
        with tempfile.TemporaryDirectory() as fixture:
            docs = Path(fixture) / "docs"
            docs.mkdir()
            (docs / "api-contract.md").write_text("# Empty API contract\n")
            result = subprocess.run(
                [BASH, str(CHECK)], cwd=fixture, capture_output=True, text=True
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing endpoint: GET /api/auth/csrf", result.stderr)

    def test_current_repository_contract_passes(self):
        result = subprocess.run(
            [BASH, str(CHECK)], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
