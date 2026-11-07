# 🤖 Actual AI

<p>
    <a href="https://github.com/sakowicz/actual-ai">
        <img alt="GitHub Release" src="https://img.shields.io/github/v/release/sakowicz/actual-ai?label=GitHub">
    </a>
    <a href="https://hub.docker.com/r/sakowicz/actual-ai">
        <img alt="Docker Image Version" src="https://img.shields.io/docker/v/sakowicz/actual-ai?label=Docker%20Hub">
    </a>
    <a href="https://codecov.io/github/sakowicz/actual-ai" >
        <img alt="Test Coverage" src="https://codecov.io/github/sakowicz/actual-ai/graph/badge.svg?token=7ZLJUN61QE"/>
    </a>
</p>

This is a project that allows you to categorize uncategorized transactions
for [Actual Budget](https://actualbudget.org/)
using [OpenAI](https://openai.com/api/pricing/), [Anthropic](https://www.anthropic.com/pricing#anthropic-api), [Google Generative AI](https://ai.google/discover/generativeai/), [Ollama](https://github.com/ollama/ollama)
or any other compatible API (including OpenRouter).

## 🌟 Features

#### 📊 Classify transactions using LLM

The app sends requests to the LLM to classify transactions based on their description, amount, and notes.

#### 🔄 Sync accounts before classification

#### 🕒 Classify transactions on a cron schedule

#### ❌ When a transaction cannot be classified, it is marked in Notes as "not guessed," and it will not be classified again.

#### ✅ Every guessed transaction is marked as guessed in notes, so you can review the classification.

#### 🌱 Suggest and create new categories for transactions that don't fit existing ones

When enabled, the LLM can suggest entirely new categories for transactions it cannot classify, and optionally create them automatically.

#### 🌐 Web search for unfamiliar merchants

Using the ValueSerp API, the system can search the web for information about unfamiliar merchants to help the LLM make better categorization decisions.

#### 🔄 Re-run missed transactions

Re-process transactions previously marked as unclassified.

## 🚀 Usage

Sample `docker-compose.yml` file:

```yaml
services:
  actual_server:
    image: docker.io/actualbudget/actual-server:latest
    ports:
      - '5006:5006'
    volumes:
      - ./actual-data:/data
    restart: unless-stopped

  actual-ai:
    image: docker.io/sakowicz/actual-ai:latest
    restart: unless-stopped
    depends_on:
      actual_server:
        condition: service_healthy
    environment:
      ACTUAL_SERVER_URL: http://actual_server:5006
      ACTUAL_PASSWORD: your_actual_password
      ACTUAL_BUDGET_ID: your_actual_budget_sync_id # This is the ID from Settings → Show advanced settings → Sync ID
      CLASSIFICATION_SCHEDULE_CRON: 0 */4 * * * # How often to run classification.
      LLM_PROVIDER: openai # Can be "openai", "chatgpt", "openrouter", "anthropic", "google-generative-ai", "ollama" or "groq"
      FEATURES: '["classifyOnStartup", "syncAccountsBeforeClassify", "suggestNewCategories"]'
#      VALUESERP_API_KEY: your_valueserp_api_key # API key for ValueSerp, required if webSearch tool is enabled
#      OPENAI_API_KEY:  # optional. required if you want to use the OpenAI API
#      OPENAI_MODEL:  # optional. required if you want to use a specific model, default is "gpt-5-mini"
#      OPENAI_BASE_URL:  # optional. required if you don't want to use the OpenAI API but OpenAI compatible API, ex: "http://ollama:11424/v1
#      OPENROUTER_API_KEY:  # optional. required if you want to use OpenRouter
#      OPENROUTER_MODEL:  # optional. default is "deepseek/deepseek-v3.2"
#      OPENROUTER_BASE_URL:  # optional. default: "https://openrouter.ai/api/v1"
#      OPENROUTER_REFERRER:  # optional but recommended by OpenRouter (or OPENROUTER_REFERER)
#      OPENROUTER_TITLE:  # optional. default: "actual-ai"
#      LLM_TIMEOUT_MS:  # optional. request timeout in ms for LLM calls, default: 120000
#      OPENROUTER_ENABLE_TOOL_CALLING:  # optional. "true" to allow model tool-calling on openrouter, default: false
#      LLM_TEMPERATURE:  # optional. temperature for LLM calls, e.g. 1 for models that reject other values
#      ANTHROPIC_API_KEY:  # optional. required if you want to use the Anthropic API
#      ANTHROPIC_MODEL:  # optional. required if you want to use a specific model, default is "claude-3-5-sonnet-latest"
#      ANTHROPIC_BASE_URL:  # optional. default: "https://api.anthropic.com/v1
#      GOOGLE_GENERATIVE_AI_API_KEY:  # optional. required if you want to use the Google Generative AI API
#      GOOGLE_GENERATIVE_AI_MODEL:  # optional. required if you want to use a specific model, default is "gemini-1.5-flash"
#      GOOGLE_GENERATIVE_AI_BASE_URL:  # optional. default: "https://generativelanguage.googleapis.com"
#      OLLAMA_MODEL=llama3.1 optional. required if you want to use an Ollama specific model, default is "phi3.5"
#      OLLAMA_BASE_URL=http://localhost:11434/api # optional. required for ollama provider
#      GROQ_API_KEY:  # optional. required if you want to use the Groq API
#      GROQ_MODEL:  # optional. required if you want to use a specific model, default is "mixtral-8x7b-32768"
#      GROQ_BASE_URL:  # optional. default: "https://api.groq.com/openai/v1"
#      ACTUAL_E2E_PASSWORD:  # optional. required if you have E2E encryption
#      NODE_TLS_REJECT_UNAUTHORIZED: 0 # optional. required if you have trouble connecting to Actual server 
#      NOT_GUESSED_TAG=#actual-ai-miss
#      GUESSED_TAG=#actual-ai
```

### Use a ChatGPT plan on a self-hosted server

The `chatgpt` provider uses [Sign in with ChatGPT](https://developers.openai.com/siwc/quickstart)
and the signed-in account's eligible ChatGPT plan instead of an API key. It is in preview and
subject to account eligibility, shared usage limits and OpenAI's terms. Usage may consume
available credits if enabled on the account. Review usage and limits in
[ChatGPT settings](https://chatgpt.com/#settings/usage). There is no automatic fallback to a
paid API key. Transaction descriptions, amounts and notes are sent to OpenAI for classification.

#### Docker on a remote Linux host: build from Git and sign in without copying files

In the existing Compose service, keep your Actual Budget connection and feature settings and
replace the image with the following build settings. Include `dryRun` in your existing `FEATURES`
for the first test. This uses a named volume exclusively for ChatGPT credentials:

```yaml
services:
  actual-ai:
    image: actual-ai-chatgpt:local
    build:
      context: https://github.com/adelgoit/actual-ai.git#master
    environment:
      LLM_PROVIDER: chatgpt
      CHATGPT_AUTH_DIR: /auth
    volumes:
      - chatgpt-auth:/auth

volumes:
  chatgpt-auth:
    name: actual-ai-chatgpt-auth
```

The fork must contain the committed changes. Build or rebuild the image in Portainer before
signing in. If Portainer manages Docker as a remote environment, its Compose build support may
be restricted; consult [Portainer's known issue](https://docs.portainer.io/faqs/known-issues/docker-compose-files-including-build-steps-fail).
Stop the service while signing in so it does not access the credentials concurrently.

The following commands are run in PowerShell on Windows 11. Replace `USER` and `LXC_IP` with
the SSH user and address of the **LXC running Docker**, not necessarily the Proxmox host. SSH
access and permission for that user to run Docker are required. Run these two initialization
commands once, after building the image, to make the dedicated volume writable only by the
container's `node` user:

```powershell
ssh USER@LXC_IP docker run --rm --user 0 --entrypoint chown -v actual-ai-chatgpt-auth:/auth actual-ai-chatgpt:local 1000:1000 /auth
ssh USER@LXC_IP docker run --rm --user 0 --entrypoint chmod -v actual-ai-chatgpt-auth:/auth actual-ai-chatgpt:local 700 /auth
```

Then start sign-in with a single command. It opens a temporary SSH tunnel and runs the login
in a short-lived container on the Docker host. Open the printed OpenAI URL in the Windows
browser, authorize the plan, and leave the terminal open until sign-in finishes:

```powershell
ssh -o ExitOnForwardFailure=yes -L 127.0.0.1:1455:127.0.0.1:1455 USER@LXC_IP docker run --rm --network host -e CHATGPT_AUTH_DIR=/auth -e CHATGPT_CALLBACK_PORT=1455 -v actual-ai-chatgpt-auth:/auth actual-ai-chatgpt:local node dist/src/chatgpt-login.js login
```

Port 1455 must be available on Windows and on the LXC. The callback is bound to loopback;
do not publish it through Nginx Proxy Manager. The temporary login container needs Linux host
networking because Docker bridge port publishing cannot expose a listener bound to its own
loopback. Start the service again after successful sign-in. No credentials are copied to the PC:
the service reads and renews them from the named volume. The tunnel is needed again only if a
new sign-in is required, for example after revocation or refresh-token expiry. To disconnect,
stop the service and run `docker run --rm -e CHATGPT_AUTH_DIR=/auth -v actual-ai-chatgpt-auth:/auth actual-ai-chatgpt:local node dist/src/chatgpt-login.js logout` on the LXC.

#### Alternative: local sign-in and protected transfer

Build this version of the project on the server or deploy an image built from it. Add a private,
persistent directory to the `actual-ai` service in your Compose file:

```yaml
services:
  actual-ai:
    environment:
      LLM_PROVIDER: chatgpt
      CHATGPT_AUTH_DIR: /data/chatgpt-auth
      # Optional: select a model slug available to the connected account.
      # CHATGPT_MODEL: your-model-slug
    volumes:
      - /your/private/actual-ai-chatgpt:/data/chatgpt-auth
```

Create that directory on the server with owner-only access (mode `700`), owned by the user
running the container (`node`, normally UID 1000 in this image). Keep it outside the build
context and backups accessible to others. The container must be able to write to it. Create
the server's own host ID once:

```sh
docker compose run --rm --no-deps actual-ai node dist/src/chatgpt-login.js init-host
```

On your own computer, use Node.js 22 or newer, install the project dependencies and build the
same source version. Run the login command and open the displayed URL on that computer:

```sh
npm ci
npm run build
node dist/src/chatgpt-login.js login
```

The callback listens only on `127.0.0.1`. Approve plan usage in the browser. The credential file
is `~/.actual-ai-chatgpt/credentials.json` by default (`%USERPROFILE%\.actual-ai-chatgpt\credentials.json`
on Windows). Set `CHATGPT_AUTH_DIR` before login to choose a different private directory. On
Windows, restrict its ACL to your user; Unix directories must have mode `700` and credentials
mode `600`. These files contain renewable credentials: do not email, log, commit, or include
them in the Docker image.

Transfer the credential file to the server over a secure channel such as SSH, placing the
temporary copy in the mounted private directory with mode `600` and readable by the container
user. With the service stopped, import it inside the container (the server's host ID is retained):

```sh
docker compose run --rm --no-deps actual-ai node dist/src/chatgpt-login.js import /data/chatgpt-auth/incoming.json
```

Remove the temporary `incoming.json` after a successful import. Start the service and verify a
classification in dry-run mode before enabling normal changes. Once the server session is
verified, remove the local credential copy; only the server should refresh this session. Do not
import the same old file again after the server has refreshed it. To sign out on the server,
stop the service and run `docker compose run --rm --no-deps actual-ai node dist/src/chatgpt-login.js logout`.
If revocation cannot be confirmed, disconnect the app in ChatGPT settings.

The provider discovers an available model when `CHATGPT_MODEL` is empty. Model tool calling,
including ValueSerp calls initiated by the model, is unavailable with this provider. If sign-in,
quota or a request fails, the current batch stops without marking the affected transaction as
unclassified. After an interrupted process, a stale `.credentials.lock` can prevent access;
remove it only after confirming no other process is using the credential directory.

## Feature Configuration

You can configure features using `FEATURES` (JSON array) or `ENABLED_FEATURES` (comma-separated list or JSON array):

The `FEATURES` environment variable accepts a JSON array of feature names to enable:

```
FEATURES='["suggestNewCategories", "classifyOnStartup", "syncAccountsBeforeClassify"]'

# Equivalent:
ENABLED_FEATURES='suggestNewCategories,classifyOnStartup,syncAccountsBeforeClassify'
```

Available features:
- `webSearch` - Enable web search for merchant information
- `suggestNewCategories` - Allow suggesting new categories for transactions
- `classifyOnStartup` - Run classification when the application starts
- `syncAccountsBeforeClassify` - Sync accounts before running classification
- `dryRun` - Run in dry run mode (enabled by default)
- `rerunMissedTransactions` - Re-process transactions previously marked as unclassified
- `disableRateLimiter` - Disable Rate Limiter

## Scheduling

With `CLASSIFICATION_SCHEDULE_CRON` set, the container stays up and runs every scheduled
classification in a fresh child process. `@actual-app/api` keeps state in module-level singletons
that survive `shutdown()`, and in a container running for weeks that state drifts until incremental
sync reports no new messages and imports quietly stop. A new process per run keeps that state fresh
without needing a restart. Logs from the run appear as usual, and a schedule that fires while the
previous run is still going is skipped.

Without a cron schedule, `classifyOnStartup` classifies once and the process exits — the right shape
when an external scheduler owns the timing.

## Rate Limit Overrides

By default each provider gets a conservative request/token-per-minute limit. You can override these per deployment with two environment variables — useful when your plan's actual limits differ from the built-in defaults (e.g. Google AI Free Tier sits well below the default 300 RPM):

- `REQUESTS_PER_MINUTE` — proactive request-per-minute cap
- `TOKENS_PER_MINUTE` — proactive token-per-minute cap

Each variable supports three states:

- **unset** (or empty) — fall back to the built-in provider default
- **`0`** — disable that axis of proactive rate limiting (the provider's own 429 responses still drive reactive backoff)
- **positive number** — use as the custom limit

To turn off rate limiting entirely, add `disableRateLimiter` to your `FEATURES` array instead.

## OpenRouter Tool Calling

By default, model tool-calling is disabled when `LLM_PROVIDER=openrouter` because some gateway/model combinations can return unstable tool-call responses. You can re-enable it with:

```
OPENROUTER_ENABLE_TOOL_CALLING=true
```

## Customizing the Prompt

To create a custom prompt, modify the `PROMPT_TEMPLATE` environment variable to include or exclude variables as needed.
Ensure that the [Handlebars](https://handlebarsjs.com/) syntax is correctly used to handle conditional rendering and
loops.

### Variables

1. `categoryGroups`: An array of category group objects. Each category group contains an array of categories.
    - `categoryGroup` is object with the following properties:
        - `id`: The ID of the category group.
        - `name`: The name of the category group.
        - `categories`: An array of category objects.
            - `category` is an object with the following properties:
                - `id`: The ID of the category.
                - `name`: The name of the category.
2. `amount`: The absolute value of the transaction amount.
3. `type`: The type of transaction, either 'Income' or 'Outcome'.
4. `description`: The notes or description of the transaction. This is taken from `transaction.notes`.
5. `payee`: The name of the payee associated with the transaction. This is found by matching the payee ID in the
   transaction with the payee list.
6. `importedPayee`: The imported payee name from the transaction. This is taken from `transaction.imported_payee`.
7. `date`: The date of the transaction. This is taken from `transaction.date`.
8. `cleared`: A boolean indicating if the transaction is cleared. This is taken from `transaction.cleared`.
9. `reconciled`: A boolean indicating if the transaction is reconciled. This is taken from `transaction.reconciled`.

## New Category Suggestions

When `suggestNewCategories` feature is enabled, the system will:

1. First try to classify transactions using existing categories
2. For transactions that can't be classified, request a new category suggestion from the LLM
3. Check if similar categories already exist
4. If in dry run mode (`dryRun` is enabled), just log the suggestions
5. If not in dry run mode, create the new categories and assign transactions to them

This feature is particularly useful when you have transactions that don't fit your current category structure and you want the LLM to help expand your categories intelligently.

## Tools Integration

The system supports various tools that can be enabled to enhance the LLM's capabilities:

1. Enable tools by including them in the `FEATURES` array
2. Provide any required API keys for the tools you want to use

Currently supported tools:

### webSearch

The webSearch tool uses the ValueSerp API to search for information about merchants that the LLM might not be familiar with, providing additional context for categorization decisions.

To use this tool:
1. Include `webSearch` in your `FEATURES` array
2. Provide your ValueSerp API key as `VALUESERP_API_KEY` (required)

This is especially helpful for:
- New or uncommon merchants
- Merchants with ambiguous names
- Specialized services that might be difficult to categorize without additional information

The search results are included in the prompts sent to the LLM, helping it make more accurate category assignments or suggestions.

## Dry Run Mode

The `dryRun` feature is enabled by default. In this mode:
- No transactions will be modified
- No categories will be created
- All proposed changes will be logged to console
- System will show what would happen with real execution

To perform actual changes:
1. Remove `dryRun` from your FEATURES array
2. Ensure `suggestNewCategories` is enabled if you want new category creation
3. Run the classification process

Dry run messages will show:
- Which transactions would be categorized
- Which rules would be applied
- What new categories would be created
- How many transactions would be affected by each change
