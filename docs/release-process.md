# Shared production release

Production must deploy the shared `main` branch, automatically after the GitHub checks pass. Feature branches must merge into `main` through a pull request before deployment; do not switch the production service to a feature branch. `codex/production-release` is retired and kept only as a backup: do not push to it or open pull requests into it.

Before merging, fetch the current production deploy commit and all current release heads. Verify that the candidate contains the deployed commit with `git merge-base --is-ancestor <deployed-sha> <candidate-sha>`. If not, merge the missing history, resolve conflicts, and run verification again. Never force-push the release branch.

Require a green Power Zone verification run for the exact candidate commit before deployment. It includes the production build, tools/test type checks, native PostgreSQL tests, and browser checks. Confirm the exact deployed SHA and health endpoint after Render reports live. Preserve colleagues' changes and existing financial records.

Initial integration preserves both the Back-arrow release bb3f49b031a2675919fff6882264f6d7baf54f82 and quotation revision release bc7defae68de5362b12dd5e88d13c5feff91abd6. Two receipt-test fixtures use the production document type and typed access tuples; assertions are unchanged.
