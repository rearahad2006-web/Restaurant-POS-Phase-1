---
name: Restaurant POS data safety
description: Standing constraints for local POS verification and data migration.
---

For Restaurant POS testing and local-runtime verification, use disposable data. Never migrate or overwrite real restaurant data.

**Why:** The user explicitly set this safety boundary in the Phase 2.2 and Windows launch briefs.

**How to apply:** Use temporary SQLite databases and disposable migration JSON for tests and launch checks; leave real restaurant records untouched.
