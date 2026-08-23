# Data pipelines

## Trader Joe's

Run `bash scripts/tj/run_pipeline.sh` locally. Akamai blocks datacenter runners,
so the scrape must originate from a residential/local network. The pipeline
scrapes the catalog, parses nutrition and ingredients, transfers artifacts through
SSH-over-SSM, imports them into RDS, and backfills embeddings.

## Whole Foods

Run `bash scripts/wholefoods/run_pipeline.sh` manually, or use
`.github/workflows/wholefoods-scraper.yml`. The workflow runs monthly on the 20th
for San Jose store 10259, imports through the EC2 host, and backfills item,
nutrition, and ingredient embeddings.

## Spoonacular recipes

Activate `.venv`, set `DATABASE_URL` and `SPOONACULAR_API_KEY`, then run:

```bash
python scripts/spoonacular/fetch_recipes.py --total 300
```

Add `--embed` and set `OPENAI_API_KEY` to populate recipe embeddings. Spoonacular
recipes are inspiration retrieved on demand by the agent; generated plan metadata
does not retain a fixed template list.
