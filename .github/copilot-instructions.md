# Copilot instructions for Servfix

## General approach
- Prioritize simple, maintainable solutions that fit a small but growing SaaS product.
- Avoid unnecessary abstractions and overengineering.
- Prefer incremental improvements over large rewrites.

## Development workflow
- For changes in critical business logic, work test-driven:
  1. write or update a test first
  2. verify that it fails when relevant
  3. implement the change
  4. verify that tests pass
- Always run relevant tests before suggesting a commit.
- Never suggest committing broken code.

## Critical areas
Treat the following as high-risk areas and be extra careful:
- order lifecycle
- checklist validation
- PDF report generation
- deviation handling with images
- Tripletex integration
- tenant-specific logic
- database migrations

## Code quality
- Follow clean code principles.
- Keep functions short and focused.
- Use clear and descriptive names for functions and variables.
- Prefer self-documenting code over comments.
- If a function takes multiple arguments and order may be confusing, prefer an object parameter.

## Specs and documentation
- Before implementing larger changes, check whether a spec should be created or updated in `/specs`.
- Use `/specs` to describe what the feature does, why it works that way, and important rules that must not be broken.

## Commits
- Use Conventional Commits.
- Prefer small, focused commits.
- Run relevant tests before each commit.

## Architecture
- Respect the current Servfix architecture unless there is a clear reason to change it.
- Keep admin and technician concerns separated.
- Do not introduce breaking changes to production flows without explicitly identifying them.