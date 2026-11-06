# Daily encrypted backup on Abu Bakar's Mac

Render's paid database recovery remains independent of this local client. This client downloads one encrypted application archive per Pakistan calendar day after 02:00 when the Mac, internet connection and Codex are available. It cannot download while the Mac is powered off. The next scheduled check catches up; it does not recreate every missed day's historical archive.

Run `backup.py --setup` interactively once using the configured Python runtime. Enter the administrator password and a separate 16–128 character recovery passphrase privately. Enrollment requires typing ENROLL. Setup stores a download-only device token and encryption passphrase in the login Keychain, then downloads the first backup. Keep a separate safe copy of the passphrase: losing it makes the encrypted archives unrecoverable.

The daily Codex automation must remain paused until enrollment and the first download succeed. It checks hourly, and the client skips before 02:00 or after a successful download that day. Credentials expire in one year; an administrator can revoke them in the application's backup panel. Restored databases exclude device credentials, so they require enrollment again.

Files are saved to `~/Downloads/Power-Zone-Backups` with owner-only permissions. Successful download state stays beside the client. Do not delete the client directory while the automation is active. Failed or incomplete downloads do not mark the day complete and are retried at the next check. Copy archives to an external disk periodically; a copy on the same Mac does not protect against loss of that Mac. No automatic deletion/retention policy is applied.

Tests: `python3 scripts/backup-client/test_backup.py`. Production data is never used by these tests.
