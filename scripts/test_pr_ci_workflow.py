"""Contract tests for the pull-request CI workflow."""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/ci.yml"
DEVELOPMENT_DOC = ROOT / "docs/development.md"

EXPECTED_JOB_NAMES = {
    "Repository Policy & Documentation",
    "Backend Tests",
    "Flyway Fresh-Database Validation",
    "Frontend Tests, Lint & Build",
    "RAG Tests & Dependency Integrity",
}


class PullRequestCiWorkflowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text()

    def test_runs_only_for_pull_requests_targeting_main(self):
        self.assertRegex(
            self.workflow,
            r"(?m)^\s{2}pull_request:\s*\n\s{4}branches:\s*\[main\]\s*$",
        )
        self.assertNotIn("pull_request_target", self.workflow)
        self.assertNotRegex(self.workflow, r"(?m)^\s{2}(push|workflow_dispatch):")

    def test_uses_read_only_permissions_and_pr_scoped_concurrency(self):
        self.assertRegex(
            self.workflow,
            r"(?ms)^permissions:\s*\n\s{2}contents:\s*read\s*$",
        )
        self.assertIn("github.event.pull_request.number", self.workflow)
        self.assertRegex(self.workflow, r"(?m)^\s{2}cancel-in-progress:\s*true\s*$")

    def test_exposes_stable_required_check_names(self):
        names = set(re.findall(r"(?m)^\s{4}name:\s*(.+?)\s*$", self.workflow))
        self.assertEqual(EXPECTED_JOB_NAMES, names)

    def test_runs_every_required_verification_command(self):
        required_fragments = (
            "python3 scripts/test_pr_ci_workflow.py",
            "bash scripts/check_immutable_ci_refs.sh",
            "python3 scripts/test_documentation_drift.py",
            "bash scripts/check_documentation_drift.sh",
            "./mvnw --batch-mode test",
            "./mvnw --batch-mode flyway:migrate",
            "./mvnw --batch-mode flyway:validate",
            "npm ci",
            "npm test -- --runInBand",
            "npm run lint",
            "npm run build",
            "python -m pip install --require-hashes -r rag/requirements-test.txt",
            "pip-audit -r rag/requirements.txt",
            "python -m pytest rag/tests -q",
            "bash scripts/check_rag_image_reproducibility.sh",
            "bash scripts/deploy/test_deploy_prod.sh",
        )
        for fragment in required_fragments:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.workflow)

    def test_does_not_use_secrets_or_production_delivery_steps(self):
        forbidden_fragments = (
            "secrets.",
            "environment:",
            "configure-aws-credentials",
            "amazon-ecr-login",
            "docker/build-push-action",
            "scripts/deploy/deploy_prod.sh",
            "scripts/deploy/smoke_prod.sh",
        )
        for fragment in forbidden_fragments:
            with self.subTest(fragment=fragment):
                self.assertNotIn(fragment, self.workflow)

    def test_external_actions_are_pinned_to_full_commit_shas(self):
        action_refs = re.findall(r"(?m)^\s*uses:\s*[^@\s]+@([^\s#]+)", self.workflow)
        self.assertTrue(action_refs)
        for ref in action_refs:
            with self.subTest(ref=ref):
                self.assertRegex(ref, r"^[0-9a-f]{40}$")

    def test_development_docs_list_required_checks_and_owner_setup(self):
        documentation = DEVELOPMENT_DOC.read_text()
        for name in EXPECTED_JOB_NAMES:
            with self.subTest(name=name):
                self.assertIn(f"`{name}`", documentation)
        self.assertIn("Require a pull request before merging", documentation)
        self.assertIn("Require branches to be up to date before merging", documentation)
        self.assertNotRegex(documentation, r"Restrict\s+updates")


if __name__ == "__main__":
    unittest.main()
