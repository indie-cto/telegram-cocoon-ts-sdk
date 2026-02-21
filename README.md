# Claude Code Project Template

A template repository for Claude Code projects following best practices from Boris Cherny (creator of Claude Code) and Anthropic's official recommendations.

## Quick Start

### Option 1: Use as GitHub Template (Recommended)

1. Click **"Use this template"** → **"Create a new repository"** on GitHub
2. Name your new repository and create it
3. Clone your new repo:
   ```bash
   git clone https://github.com/YOUR_USERNAME/YOUR_NEW_REPO.git
   cd YOUR_NEW_REPO
   ```

### Option 2: Fork the Repository

1. Click **"Fork"** on GitHub
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/claude-code-template.git
   cd claude-code-template
   ```

### Option 3: Manual Clone (No GitHub)

```bash
# Clone the template
git clone https://github.com/ORIGINAL_OWNER/claude-code-template.git my-project
cd my-project

# Remove original git history and start fresh
rm -rf .git
git init
git add .
git commit -m "Initial commit from claude-code-template"
```

### After Creating Your Project

1. **Edit `CLAUDE.md`** - Replace placeholders with your project details:
   - Project overview and description
   - Tech stack (language, framework, database)
   - Development commands (install, test, build, lint)
   - File organization structure

2. **Customize `.claude/settings.json`** - Update allowed commands for your stack:
   ```json
   "allow": [
     "Bash(npm test*)",    // or pytest, go test, etc.
     "Bash(npm run lint*)" // or ruff, golangci-lint, etc.
   ]
   ```

3. **Configure MCP servers** (optional) - Edit `.mcp.json` if you need external integrations

4. **Start Claude Code**:
   ```bash
   claude
   ```

## Template Structure

```
.
├── CLAUDE.md              # Project context for Claude
├── .claude/
│   ├── settings.json      # Permissions and hooks configuration
│   └── commands/          # Custom slash commands
│       ├── commit-push-pr.md
│       ├── fix-tests.md
│       └── verify.md
├── .mcp.json              # MCP server configuration (optional)
├── .tmux.conf             # tmux configuration for VPS/remote development
├── .gitignore
└── README.md
```

## Files Explained

### CLAUDE.md

The main context file that Claude reads at the start of every conversation. Include:

- Project overview and tech stack
- Development commands (build, test, lint)
- Code style conventions
- Common mistakes to avoid (your "institutional memory")
- Architecture notes

**Key practice**: When Claude makes a mistake, add it to CLAUDE.md so it doesn't repeat it.

### .claude/settings.json

Pre-approved commands and hooks:

- **permissions.allow**: Commands Claude can run without asking
- **hooks.PostToolUse**: Auto-run commands after file edits (e.g., formatting)

### .claude/commands/

Custom slash commands for repetitive workflows. Use with `/command-name`.

Included commands:
- `/commit-push-pr` - Commit, push, and create a PR
- `/verify` - Run all checks (lint, typecheck, test, build)
- `/fix-tests` - Analyze and fix failing tests

### .mcp.json

Connect external tools via MCP (Model Context Protocol). Examples:
- Puppeteer for browser automation
- Slack integration
- Database queries

### .tmux.conf

Optimized tmux configuration for remote development. Copy to your home directory:
```bash
cp .tmux.conf ~/.tmux.conf
```

## Best Practices

### From Boris Cherny

1. **Use Plan Mode** (Shift+Tab twice) - Iterate on the plan before coding
2. **Verify your work** - Give Claude ways to check its output (tests, linting)
3. **Build institutional memory** - Add mistakes to CLAUDE.md
4. **Use slash commands** - Codify repetitive workflows
5. **Auto-format with hooks** - Prevent CI failures from formatting issues

### From Anthropic

1. **Be specific** - Detailed instructions yield better first attempts
2. **Use /clear frequently** - Reset context between distinct tasks
3. **Explore-Plan-Code-Commit** - Read code first, plan, then implement
4. **Run parallel instances** - One writes code, another reviews

## Customization

### For Different Tech Stacks

Edit `.claude/settings.json` permissions:

**Python:**
```json
"allow": [
  "Bash(pip install*)",
  "Bash(pytest*)",
  "Bash(ruff*)",
  "Bash(mypy*)"
]
```

**Go:**
```json
"allow": [
  "Bash(go build*)",
  "Bash(go test*)",
  "Bash(go run*)",
  "Bash(golangci-lint*)"
]
```

### Adding Team Commands

Create `.claude/commands/your-command.md`:

```markdown
# Command Title

Description of what this command does.

## Instructions

1. Step one
2. Step two

$ARGUMENTS
```

## Remote Development (VPS)

If you're developing on a VPS or remote server, use tmux to keep Claude Code running if your connection drops.

### Setup

```bash
# Copy the included tmux config
cp .tmux.conf ~/.tmux.conf

# Start a new tmux session
tmux new -s dev
```

### Daily Workflow

```bash
# Start a new session (first time)
tmux new -s dev

# Detach from session (keeps running): Ctrl+b then d

# Reattach later
tmux attach -t dev

# List sessions
tmux ls
```

### Why tmux?

- **Session persistence** - SSH drops won't kill your Claude Code session
- **Multiple panes** - Run Claude in one pane, tests/logs in another
- **Detach/reattach** - Start a long task, disconnect, come back later

## Resources

- [Claude Code Best Practices (Anthropic)](https://www.anthropic.com/engineering/claude-code-best-practices)
- [How Boris Cherny Uses Claude Code](https://paddo.dev/blog/how-boris-uses-claude-code/)
