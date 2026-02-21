# Commit, Push, and Create PR

Commit all changes, push to remote, and create a pull request (or update existing PR).

## Instructions

1. Run `git status` to see current changes
2. Run `git diff --staged` and `git diff` to understand the changes
3. **Check current branch name** to determine the workflow:

### If already on a feature branch (e.g., `feat/*`, `fix/*`):
4. Stage all relevant changes with `git add`
5. Create a descriptive commit following conventional commits format
6. Push to update the existing branch: `git push`
7. Check if PR exists with `gh pr status` - if not, create one

### If on a base branch (e.g., `main`, `dev`, `master`):
4. **Save the current branch name** - this will be the PR target (base branch)
5. **Create a new feature branch** from the current branch:
   - Use format: `feat/<short-description>` or `fix/<short-description>` based on the change type
   - Example: `git checkout -b feat/add-user-auth`
6. Stage all relevant changes with `git add`
7. Create a descriptive commit following conventional commits format
8. Push the new feature branch to remote: `git push -u origin <branch-name>`
9. Create a pull request using `gh pr create --base <original-branch>`
   - The `--base` flag must specify the branch you started from (e.g., `dev`, `main`, etc.)

## Commit Message Format

Use conventional commits:
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation
- `refactor:` for code refactoring
- `test:` for adding tests
- `chore:` for maintenance tasks

## PR Description

Include:
- Summary of changes
- Any breaking changes
- Testing performed

$ARGUMENTS
