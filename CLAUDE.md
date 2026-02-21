# Project Guidelines for Claude

## Project Overview

<!-- Describe your project here -->
This is a [PROJECT_TYPE] project that [BRIEF_DESCRIPTION].

## Tech Stack

- **Language**: [e.g., TypeScript, Python, Go]
- **Framework**: [e.g., React, FastAPI, Express]
- **Database**: [e.g., PostgreSQL, MongoDB]
- **Testing**: [e.g., Jest, Pytest, Go test]

## Development Commands

```bash
# Install dependencies
[npm install | pip install -r requirements.txt | go mod download]

# Run development server
[npm run dev | python main.py | go run .]

# Run tests
[npm test | pytest | go test ./...]

# Build for production
[npm run build | python -m build | go build]

# Lint/Format
[npm run lint | ruff check . | golangci-lint run]

# Type check
[npm run typecheck | mypy . | go vet ./...]
```

## Code Style & Conventions

### General Rules

- Follow existing code patterns in the codebase
- Keep functions small and focused (single responsibility)
- Use meaningful variable and function names
- Write self-documenting code; add comments only when logic isn't obvious

### File Organization

<!-- Describe your project structure -->
```
src/
  components/    # UI components
  services/      # Business logic
  utils/         # Helper functions
  types/         # Type definitions
tests/
  unit/          # Unit tests
  integration/   # Integration tests
```

### Naming Conventions

- Files: `kebab-case.ts` or `snake_case.py`
- Components: `PascalCase`
- Functions: `camelCase` or `snake_case`
- Constants: `SCREAMING_SNAKE_CASE`

## Testing Requirements

- Write tests for new functionality
- Ensure existing tests pass before committing
- Use descriptive test names that explain the expected behavior
- Mock external dependencies appropriately

## Git Workflow

- Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- Keep commits atomic and focused
- Write clear commit messages explaining the "why"

## Common Mistakes to Avoid

<!-- Add patterns that Claude should avoid - this is your "institutional memory" -->
<!-- Example entries below - customize for your project -->

- YOU MUST run tests before creating a PR
- NEVER commit `.env` files or secrets
- NEVER hardcode secrets, API keys, passwords, or tokens in code - use environment variables instead
- ALWAYS check for accidental secrets before committing (look for hardcoded strings that look like keys/tokens)
- ALWAYS use the existing logger instead of console.log
- DO NOT add new dependencies without discussing first

## Architecture Notes

<!-- Document key architectural decisions -->
<!-- Example: -->
<!-- - We use repository pattern for database access -->
<!-- - API responses follow the format: { data, error, metadata } -->
<!-- - All dates are stored and transmitted in UTC -->

## Environment Setup

<!-- Document any required environment variables -->
Required environment variables (see `.env.example`):
- `DATABASE_URL`: Connection string for the database
- `API_KEY`: External API authentication

## Verification Steps

IMPORTANT: Always verify your work using these methods:
1. Run the test suite: `[test command]`
2. Run type checking: `[typecheck command]`
3. Run linting: `[lint command]`
4. For UI changes, take a screenshot or use the browser to verify
