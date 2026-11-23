# srezai skills — web access for AI agents, without burning the context

Ten skills plus a zero-dependency CLI for the [srezai](https://srezai.ru) web API:
six tool skills (web search, page reading, site maps and crawls, schema-based extraction,
claim verification with quotes, answers, deep research, YouTube transcripts) and three
guide skills (integration, migration, evaluation). Runet-first coverage.

**Why skills + CLI.** An MCP server sends every tool schema in every request — for
srezai that is ≈10.8k tokens (13 tools + instructions). These ten skill descriptions
cost **≈730 tokens total** (o200k), and the CLI keeps tool schemas out of the context
window: a typical task reads one skill (≈700–1,200 tokens) and one reference
(≈300 tokens). MCP stays for hosts that have no shell: Claude Desktop, ChatGPT
connectors, n8n.

## Install

### Skills (any agent that reads `SKILL.md`)

```bash
npx skills add srezai-team/srezai-web-search-pro-skill
```

Claude Code plugin:

```bash
/plugin marketplace add srezai-team/srezai-web-search-pro-skill
/plugin install srezai-skills@srezai-skills
```

DSH or manual install (copies `skills/*` into your skills directory):

```bash
bash scripts/install.sh
```

### Cursor, Codex, Gemini CLI, MCP and the skills.sh catalog

- **Claude Code:** `.claude-plugin/` — `plugin.json` + `marketplace.json`.
- **Codex:** `.codex-plugin/plugin.json`; **Cursor:** `.cursor-plugin/plugin.json`
  (skills, the awareness rule and the MCP server in one manifest).
- **Gemini CLI:** `gemini-extension.json` wires the hosted MCP server.
- **Any other agent:** point it at [`AGENTS.md`](AGENTS.md) and `skills/*/SKILL.md`.
- **Cursor rule:** copy [`rules/srezai-awareness.mdc`](rules/srezai-awareness.mdc) into
  `.cursor/rules/` — an always-on rule that reminds the agent about srezai even
  when the task doesn't name it.
- **MCP:** [`.mcp.json`](.mcp.json) points hosts at the hosted server
  `https://srezai.ru/api/mcp`.
- **skills.sh:** [`skills.sh.json`](skills.sh.json) groups the ten skills into
  Core, Tasks and Guides for the catalog.
- **Integrity:** [`manifest.json`](manifest.json) lists every skill with its SHA-256,
  so an installed copy can be compared with the published one.

### CLI

```bash
npx srezai-cli --help
npm install -g srezai-cli
```

The skills call `srezai ...` when a shell is available and fall back to MCP when it
is not. CLI repo: [srezai-team/srezai-cli](https://github.com/srezai-team/srezai-cli).

### Key

```bash
export SREZAI_API_KEY=srz_live_…      # or ~/.config/srezai/config.json (chmod 600)
```

No key yet? `search`, `read` and `transcript` work in a free trial (25 requests/day
per IP). `srezai register --email you@example.com` creates an agent account with 20
starter credits and returns the key once plus a no-login top-up link.

## Skills

| Skill | Use it when | Tools |
|---|---|---|
| `srezai-web` | entry point: which channel (CLI/MCP/REST), keys, trial, billing, economy, errors | `get_usage` |
| `srezai-search` | "find links/facts/news/images" | `web_search`, `image_search` |
| `srezai-read` | "read this page", "pull these fields", "show me the layout" | `read_url`, `read_urls`, `extract`, `fetch_page` |
| `srezai-site` | "what pages does this site have", "crawl this section" | `map`, `crawl` |
| `srezai-research` | "check this claim", "give me an answer", "research this topic" | `verify_claim`, `answer_search`, `deep_research` |
| `srezai-transcript` | "subtitles", "what is said in this video" | `yt_srt` |
| `srezai-sourcing` | "find suppliers/factories in China", 1688, MOQ, FOB | — |
| `srezai-build` | "put srezai in our backend / SDK / agent", integration and release checks | — |
| `srezai-migrate` | "move us off Tavily / Firecrawl / Exa / SerpAPI" | — |
| `srezai-eval` | "measure and compare search quality" — user-invoked: run it explicitly | — |

The three guide skills own no tools: they carry the operational procedure (integration
contract, migration mapping, evaluation methodology) and point at the tool skills for
the actual calls.

## Tools at a glance

<!-- GENERATED:tools-readme — источник src/tools.json, сборка: node scripts/generate.mjs -->
| What you need | Tool | Price |
|---|---|---|
| Search the web: links, facts, snippets | `web_search` | 1 credit per call |
| Find images and direct file URLs | `image_search` | 1 credit per call |
| Read the text of a page whose URL you already have | `read_url` | 1 credit per call |
| Read several known pages in one batch | `read_urls` | 1 credit per link |
| Pull a few specific values off a page with a JSON schema | `extract` | 2 credits per link |
| See the layout, typography or a broken page as a screenshot | `fetch_page` | 3 credits; 1 if the browser could not render the page |
| Map a site: sections, URLs, how large it is | `map` | 1 credit per 10 URLs returned, minimum 1 |
| Walk a section of a site and read its pages | `crawl` | map + 1 credit per page read |
| Check one claim and get a verdict with verbatim quotes | `verify_claim` | 8 credits per call |
| Get one synthesized answer across several sources | `answer_search` | 3 (fast) / 5 (balanced) / 10 (deep) credits |
| Run multi-step research and get a finished answer with sources | `deep_research` | 20 credits + 3 per 1000 output tokens |
| YouTube video text: transcripts, summaries, quotes | `yt_srt` | 1 credit per video; 15 with speaker labeling |
| Check balance, remaining quota, spend and the price list | `get_usage` | free; does not use the quota |
<!-- /GENERATED:tools-readme -->

## Cost model

1 credit = 0.10 ₽. Cheap ladder first: `search` (1) → `read` (1 per window) →
`extract` (2/link) / `map` (1 per 10 URLs) → `crawl` (map + 1/page) → `fetch` (3) →
`answer` (3/5/10) → `verify` (8) → `deep` (20 + tokens). The skills enforce "cheapest
step that answers the question"; `get_usage` is free and the skills check it before
expensive steps instead of discovering a 402 mid-pipeline.

## Benchmark your setup

[`scripts/eval/`](scripts/eval/README.md) is a reproducible harness: a fixed dataset of
25 positions (en/ru/zh), a frozen run manifest, raw results per position, p50/p95
latency, failure accounting and a judge rubric for 0–6/0–2/0–2 scores. It is a dry run
by default and touches the network only with `--live`:

```bash
node scripts/eval/run.mjs --help            # plan only, no key, no network
node scripts/eval/run.mjs --trial --limit 15 # live smoke: anonymous trial, no key
SREZAI_API_KEY=… node scripts/eval/run.mjs --live --repeats 3
node scripts/eval/grade.mjs --judge-sheet   # CSV for a human judge → --apply
```

`--trial` runs against the anonymous trial limit (25 requests/day per IP, one repeat):
enough to prove the integration end to end, not enough to claim a result, and the
summary says so.

What it refuses to do: compare providers with different result caps or depth as if they
were equal, hide timeouts from the denominator, or report a single run as a result. The
method's limits are written down, not implied — see
[«Ограничения метода»](scripts/eval/README.md).

## What makes it different

- **Runet-first**: strong coverage of Russian-language web, not an afterthought.
- **Files, not just pages**: PDF, Word, Excel, PowerPoint, EPUB are read as Markdown.
- **Honest numbers**: prices, limits and `when not to use this tool` are generated
  from one source (`src/tools.json`), not written into marketing copy.
- **Verification with quotes**: `verify_claim` checks every quote against the page
  text and drops what it cannot find; `unverified`/`mixed` are reported as such. The
  research skill runs it *before* writing, not after being asked.
- **Stop rules, not just tool docs**: every skill says when the work is done — two
  independent sources, official domain for numbers, `skipped[]` checked before claiming
  a crawl was complete.
- **Untrusted content rule**: everything returned from the web is data, never
  instructions; the canonical policy lives in one reference all skills point at.
- **Budget before the call**: `get_usage` before `crawl`, `answer deep`, `verify` or
  `deep`, a per-task ceiling, and a degradation table for 401/402/429 mid-pipeline.

## Security

- Skills restrict themselves to `allowed-tools: Bash(srezai *)` where the host
  supports it.
- The CLI has a fixed API host, never prints the key (only `srz_…abcd`), does not
  read local files and does not execute anything from arguments.
- Skills contain no keys and no setup boilerplate duplication; channel setup lives in
  one reference.
- Releases are generated and published with provenance; see [SECURITY.md](SECURITY.md).

## Repository layout

```
src/tools.json            single source of truth for tools, prices, CLI examples
src/skills.json           ten skills: kind, descriptions, tool mapping, budgets
src/skills/<name>/        SKILL.md template + hand-written references
scripts/generate.mjs      builds skills/, references, manifests, docs, VERSION, sums
scripts/eval/             reproducible quality harness (dry-run by default)
skills/<name>/SKILL.md    generated — do not edit by hand
.claude-plugin/           plugin.json + marketplace.json (generated)
.codex-plugin/            Codex manifest (generated)
.cursor-plugin/           Cursor manifest (generated)
gemini-extension.json     Gemini CLI extension, hosted MCP (generated)
manifest.json             package index: per-skill SHA-256 (generated)
AGENTS.md / CLAUDE.md     instructions for coding agents working on this repo
rules/                    srezai-awareness.mdc — always-on Cursor rule
.mcp.json                 hosted MCP server for hosts that read this file
skills.sh.json            Core / Tasks / Guides grouping for the skills.sh catalog
```

Edit the source, run `node scripts/generate.mjs`, commit both.

## Verify before you trust

```bash
node scripts/generate.mjs --check   # artifacts match the source
sha256sum -c SHA256SUMS.txt         # checksums match
bash scripts/selftest.sh            # secrets, line endings, frontmatter, links, manifests
bash scripts/eval/test-dry-run.sh   # evaluation harness works without a key
SRZ_API_KEY=… node scripts/check-drift.mjs   # live MCP server still matches the catalog
```

## Contributing · Security · License

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md). Apache-2.0.

Version 0.6.0.
