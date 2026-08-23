#!/usr/bin/env bash
set -euo pipefail

first_tag="mealgen-rag-repro:first"
second_tag="mealgen-rag-repro:second"

docker build --no-cache --tag "$first_tag" rag
docker build --no-cache --tag "$second_tag" rag

first_manifest="$(docker run --rm --entrypoint python "$first_tag" -m pip freeze --all)"
second_manifest="$(docker run --rm --entrypoint python "$second_tag" -m pip freeze --all)"

if [[ "$first_manifest" != "$second_manifest" ]]; then
  echo "RAG image dependency manifests are not reproducible" >&2
  diff <(printf '%s\n' "$first_manifest") <(printf '%s\n' "$second_manifest") || true
  exit 1
fi

echo "RAG image dependency manifests are reproducible"
