# Fix Failing Tests

Analyze and fix failing tests in the project.

## Process

1. Run the test suite to identify failures
2. For each failing test:
   - Understand what the test is checking
   - Determine if the test or implementation is wrong
   - Fix the appropriate code
3. Re-run tests to verify fixes
4. Ensure no regressions were introduced

## Guidelines

- Prefer fixing implementation over modifying tests
- If a test is genuinely wrong, explain why before modifying
- Run the full test suite after fixes, not just the previously failing tests

$ARGUMENTS
