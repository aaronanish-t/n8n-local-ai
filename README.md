# n8n-local-ai

[![CI](https://github.com/aaronanish-t/n8n-local-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/aaronanish-t/n8n-local-ai/actions/workflows/ci.yml)

Self-hosted [n8n](https://n8n.io) in Docker that uses a local model through [Ollama](https://ollama.com), with three exported workflows: a chat, an agent with memory and a tool, and a scheduled morning briefing written into an Obsidian vault. The model runs on your machine; n8n itself still contacts n8n's servers for things like update checks.

## Requirements

- Docker Desktop (on Windows, with WSL2)
- Ollama running on the host, with the model pulled:

  ```bash
  ollama pull llama3.2:3b
  ```

- Node.js 20 or newer, only for running the tests

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
| `03-daily-study-briefing.json` | Every day at 8:00, or from **Test run**: reads `Tasks/_Tracker.md` and the newest `Daily/` note, lists open tasks straight from the tracker, asks the model to pick up to 3 focus items and a quick win, and saves `Inbox/YYYY-MM-DD Morning Briefing.md`. |

Import a workflow with **Workflows → ⋯ → Import from File**, or:

```bash
docker cp workflows/01-local-chat.json n8n:/tmp/wf.json
docker exec n8n n8n import:workflow --input=/tmp/wf.json
```

After importing, pick your Ollama credential on each **Ollama Chat Model** node. Publish workflow 03 to turn its schedule on; it only runs while the machine is on and Docker Desktop is running.

To run a workflow from the command line while n8n is running, give the CLI its own task runner port. The workflow needs a Manual Trigger, which workflow 03 has.

```bash
docker exec -e N8N_RUNNERS_BROKER_PORT=5690 n8n n8n execute --id=<workflow id>
```

### Limits of a 3B model

- `llama3.2:3b` sometimes writes a tool call as plain text instead of calling the tool. In a direct Ollama test it called the calculator correctly in 2 of 3 tries. Resend the message, or switch to a larger model such as `qwen2.5:7b`.
- The briefing's suggested actions are guesses, because the model only sees task titles. The open-task list is built in code, not by the model.

## Vault layout

The briefing expects an Obsidian-style vault:

```
Tasks/_Tracker.md   table rows like: | active | 2026-01-02 | [[2026-01-02 Task name\|Task name]] |
Daily/YYYY-MM-DD.md notes with a "## Next steps" list
Inbox/              where briefings are written
```

`example-vault/` has a small sample and is used when `VAULT_PATH` is not set. The vault is mounted read-only at `/vault`, except `Inbox/`, and `N8N_RESTRICT_FILE_ACCESS_TO` limits n8n's file nodes to `/files` and `/vault`.

## Data

Workflows and credentials live in the Docker volume `n8n-local_n8n_data`, not in this folder. `docker compose down -v` deletes it. `./files` is shared with the container at `/files`.

## Tests

```bash
npm test
```

The tests use Node's built-in test runner and need no install. They check that every workflow is well formed: nodes are connected, no secrets are stored, Code nodes compile and the local model is used. They also run the briefing's two Code nodes against `example-vault/`: which tasks are picked, the Next steps parsing and the note format. They do not call Ollama or run n8n. CI also validates `docker-compose.yml`.

## License

[MIT](LICENSE)
