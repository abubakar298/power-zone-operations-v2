import datetime as dt
import importlib.util
import io
import json
from email.message import Message
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('backup', Path(__file__).with_name('backup.py'))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)

class Response(io.BytesIO):
    def __init__(self, data, length=None):
        super().__init__(data)
        self.headers = Message()
        self.headers['Content-Type'] = 'application/octet-stream'
        self.headers['Content-Length'] = str(len(data) if length is None else length)

class BackupTests(unittest.TestCase):
    def test_daily_gate(self):
        self.assertFalse(backup.due(dt.datetime(2026, 10, 7, 1, 59), None))
        self.assertTrue(backup.due(dt.datetime(2026, 10, 7, 2), None))
        self.assertTrue(backup.due(dt.datetime(2026, 10, 7, 18), '2026-10-06'))
        self.assertFalse(backup.due(dt.datetime(2026, 10, 7, 18), '2026-10-07'))

    def test_success_and_same_day_skip(self):
        with tempfile.TemporaryDirectory() as root:
            state = Path(root) / 'state.json'
            with patch.object(backup, 'STATE', state), patch.object(backup.Path, 'home', return_value=Path(root)), patch.object(backup, 'keychain_read', return_value={'token':'test','passphrase':'test'}), patch.object(backup, 'request', return_value=Response(b'PZBACK01'+b'x'*60)) as request:
                backup.run(force=True)
                saved = Path(json.loads(state.read_text())['file'])
                self.assertEqual(saved.read_bytes(), b'PZBACK01'+b'x'*60)
                self.assertEqual(saved.stat().st_mode & 0o777, 0o600)
                backup.run()
                self.assertEqual(request.call_count, 1)

    def test_truncated_download_leaves_no_backup_or_success(self):
        with tempfile.TemporaryDirectory() as root:
            state = Path(root) / 'state.json'
            with patch.object(backup, 'STATE', state), patch.object(backup.Path, 'home', return_value=Path(root)), patch.object(backup, 'keychain_read', return_value={'token':'test','passphrase':'test'}), patch.object(backup, 'request', return_value=Response(b'PZBACK01'+b'x'*60, 1000)):
                with self.assertRaises(RuntimeError):
                    backup.run(force=True)
                self.assertFalse(state.exists())
                self.assertEqual(list((Path(root)/'Downloads'/'Power-Zone-Backups').iterdir()), [])

if __name__ == '__main__':
    unittest.main()
