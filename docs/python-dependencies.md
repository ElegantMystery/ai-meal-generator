# Python dependency maintenance

The RAG service separates human-maintained inputs from generated, hash-locked
install files:

- `rag/requirements.in` contains production dependencies.
- `rag/requirements-test.in` contains CI and test tooling.
- The matching `.txt` files pin every transitive dependency and accepted artifact
  hash. Docker and CI install only these locks with `--require-hashes`.

## Updating dependencies

Generate locks with Python 3.11 and pip-tools 7.6.1, matching CI and the RAG base
image:

```bash
cd rag
pip-compile --generate-hashes --strip-extras --resolver=backtracking \
  --output-file=requirements.txt requirements.in
pip-compile --allow-unsafe --generate-hashes --strip-extras \
  --resolver=backtracking --output-file=requirements-test.txt requirements-test.in
```

Commit each input and its generated lock together. Dependabot proposes weekly pip
and GitHub Actions updates. CI rejects stale locks and runs `pip-audit` against the
production dependency set.

## Verification

Install and test from the lock, then verify two clean image builds produce the
same installed package/version manifest:

```bash
python -m pip install --require-hashes -r rag/requirements-test.txt
python -m pytest rag/tests -q
bash scripts/check_rag_image_reproducibility.sh
```

Image and layer metadata can contain builder timestamps, so the check compares the
runtime dependency manifest rather than mutable image IDs or archive metadata.
