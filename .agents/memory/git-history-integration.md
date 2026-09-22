---
name: Diverged history integration
description: Safe local integration when a remote branch contains an older duplicate of an amended local commit.
---

When a remote commit is semantically already represented by the current local tree, first preserve the local tip, prove the remote-to-local replacement differs only by expected generated artifacts, and use a normal `--no-ff` ours merge to record both histories without replaying stale conflicts.

**Why:** Repeated content merges can recreate conflicts between an amended local commit and its older remote predecessor even when the remote branch has no unique product behavior to add. Blind whole-file resolution is unsafe; a verified tree-preserving merge is explicit and reversible.

**How to apply:** Keep both refs reachable, compare the remote commit with the local replacement and inspect for deleted remote files before the merge. Run the full validation gate while the merge is prepared, then create exactly one merge commit and verify the remote tip is an ancestor of local main. GitHub's Git-commits API may normalize away the final commit-message newline, so compare the resulting tree, parent, author, message, and content rather than requiring the API-created SHA to equal a local SHA.