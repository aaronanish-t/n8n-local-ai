# n8n-local-ai

[![CI](https://github.com/aaronanish-t/n8n-local-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/aaronanish-t/n8n-local-ai/actions/workflows/ci.yml)

Self-hosted [n8n](https://n8n.io) in Docker that uses a local model through [Ollama](https://ollama.com), with five exported workflows: a chat, an agent with memory and a tool, a scheduled morning briefing written into an Obsidian vault, a GitHub activity feed for that briefing, and a quick-capture webhook that saves notes to the vault. The model runs on your machine; n8n itself still contacts n8n's servers for things like update checks.

## Requirements

- Docker Desktop (on Windows, with WSL2)
- Ollama running on the host, with the model pulled:

  ```bash
  ollama pull llama3.2:3b
  ```

- Node.js 22 or newer, only for running the tests

## Setup

```bash
cp .env.example .env      # then set VAULT_PATH to your vault, or delete the line to use ./example-vault
docker compose up -d
```

Open http://localhost:5678 and create the local owner account. Then add an **Ollama** credential with base URL `http://host.docker.internal:11434`.

```bash
docker compose logs -f    # watch logs
docker compose down       # stop (keeps your data)
docker compose pull && docker compose up -d   # update n8n
```

The container restarts on its own whenever Docker Desktop is running.

## Workflows

| File | What it does |
|---|---|
| `01-local-chat.json` | Chat Trigger → Basic LLM Chain with a system prompt → Ollama `llama3.2:3b`. |
| `02-agent-with-memory.json` | Chat Trigger → AI Agent with Simple Memory (last 10 messages) and a Calculator tool → Ollama. The system prompt includes the current date and time. |
| `03-daily-study-briefing.json` | Checks every hour from 8:00 to 23:00 and writes one briefing a day, at the first check after the machine is on; **Test run** always writes one. Reads `Tasks/_Tracker.md` and the newest `Daily/` note, lists open tasks straight from the tracker, asks the model to pick up to 3 focus items and a quick win, adds yesterday's GitHub activity from workflow 04, and saves `Inbox/YYYY-MM-DD Morning Briefing.md`. |
| `04-github-activity.json` | Sub-workflow called by 03. Fetches a user's public events from the GitHub API (set the user in the **Settings** node) and summarizes the previous calendar day as bullets: pushes, PRs, reviews, issues, comments, new repos and branches, stars. Private-repo activity is not in this feed. |
| `05-quick-capture.json` | `POST /webhook/capture` with `{"text": "..."}`. The model suggests a title and tags, and the note is saved as `Inbox/YYYY-MM-DD HHmmss Title.md`. Replies `201` with the file name, or `400` for empty text or text over 5000 characters. If the model fails or replies with something other than JSON, the title is the note's first words. |

Import a workflow with **Workflows → ⋯ → Import from File**, or:

```bash
docker cp workflows/01-local-chat.json n8n:/tmp/wf.json
docker exec n8n n8n import:workflow --input=/tmp/wf.json
```

After importing, pick your Ollama credential on each **Ollama Chat Model** node. Import 04 before 03, since 03 calls it by id. Publish 03, 04 and 05: 03's schedule and 05's webhook only run when published, and 03 only runs while the machine is on and Docker Desktop is running.

### Quick capture

```bash
curl -X POST http://localhost:5678/webhook/capture -H "Content-Type: application/json" -d '{"text": "Look into Raft leader election"}'
```

From PowerShell:

```powershell
Invoke-RestMethod -Method Post http://localhost:5678/webhook/capture -ContentType 'application/json' -Body (@{ text = 'Look into Raft leader election' } | ConvertTo-Json)
```

The port is bound to `127.0.0.1`, so only this machine can reach the webhook.

### Command line runs

To run a workflow from the command line while n8n is running, give the CLI its own task runner port. The workflow needs a Manual Trigger, which 03 and 04 have.

```bash
docker exec -e N8N_RUNNERS_BROKER_PORT=5690 n8n n8n execute --id=<workflow id>
```

### Limits of a 3B model

- `llama3.2:3b` sometimes writes a tool call as plain text instead of calling the tool. In a direct Ollama test it called the calculator correctly in 2 of 3 tries. Resend the message, or switch to a larger model such as `qwen2.5:7b`.
- The briefing's suggested actions are guesses, because the model only sees task titles. The open-task list is built in code, not by the model.

### GitHub rate limit

Workflow 04 calls the GitHub API without a token, which allows 60 requests an hour per IP address. Behind a shared IP, such as a VPN or Cloudflare WARP, that limit may already be used up by others. The briefing then says "rate limit reached" in its GitHub section and is still written.

## Vault layout

The briefing expects an Obsidian-style vault:

```
Tasks/_Tracker.md   table rows like: | active | 2026-01-02 | [[2026-01-02 Task name\|Task name]] |
Daily/YYYY-MM-DD.md notes with a "## Next steps" list
Inbox/              where briefings and captured notes are written
```

`example-vault/` has a small sample and is used when `VAULT_PATH` is not set. The vault is mounted read-only at `/vault`, except `Inbox/`, and `N8N_RESTRICT_FILE_ACCESS_TO` limits n8n's file nodes to `/files` and `/vault`.

## Data

Workflows and credentials live in the Docker volume `n8n-local_n8n_data`, not in this folder. `docker compose down -v` deletes it. `./files` is shared with the container at `/files`.

## Tests

```bash
npm ci
npm test
```

The tests use Node's built-in test runner; the only dependency is Luxon, the date library n8n's Code node uses. They check that every workflow is well formed: nodes are connected, no secrets are stored, Code nodes compile, the local model is used, and calls to other workflows point at one in this repo. They also run each Code node's JavaScript:

- **03:** the hourly catch-up, which tasks are picked, Next steps parsing and the note format, against `example-vault/`.
- **04:** the date window and the event summaries, against `test/fixtures/github-events.json`, plus empty and failed responses.
- **05:** input validation, the title and file-name cleaning, and the fallbacks when the model fails.

They do not call Ollama, GitHub or n8n. CI also validates `docker-compose.yml`.

## License

[MIT](LICENSE)
