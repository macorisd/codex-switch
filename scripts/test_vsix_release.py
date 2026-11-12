import base64
import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import zipfile

import vsix_release as release

TAG = 'v0.1.2'
SHA = 'a' * 40


def package(version='0.1.2', extra=None, year=2026):
    result = io.BytesIO()
    files = {
        'extension/package.json': json.dumps({'name': 'codex-provider-switch', 'publisher': 'macor-local', 'version': version}).encode(),
        'extension/extension.js': b'extension',
        'extension/backend/bridge.py': b'bridge',
        'extension/backend/credential_helper.py': b'helper',
    }
    files.update(extra or {})
    with zipfile.ZipFile(result, 'w') as archive:
        for name, content in files.items():
            archive.writestr(zipfile.ZipInfo(name, (year, 1, 1, 0, 0, 0)), content)
    return result.getvalue()


class HistoryTests(unittest.TestCase):
    text = '<svg-banner/>\n\n| Provider | Access |\n| --- | --- |\n| DeepSeek | API |\n\n| Version | Changes |\n| --- | --- |\n| 0.1.2 | Logo and release automation. |\n| 0.1.1 | Source migration. |\n\nFooter.\n'

    def test_only_matching_version_cell_changes_and_retry_is_idempotent(self):
        output = release.update_text(self.text, TAG)
        expected = self.text.replace('| 0.1.2 |', '| [0.1.2](https://github.com/macorisd/codex-switch/releases/tag/v0.1.2) |')
        self.assertEqual(output, expected)
        self.assertEqual(release.update_text(output, TAG), output)

    def test_windows_newlines_are_preserved(self):
        text = self.text.replace('\n', '\r\n')
        output = release.update_text(text, TAG)
        self.assertNotIn('\n', output.replace('\r\n', ''))

    def test_missing_or_duplicate_rows_fail_without_an_edit(self):
        for text in (self.text.replace('0.1.2', '0.1.3'), self.text.replace('| 0.1.1 |', '| 0.1.2 |')):
            with self.assertRaises(ValueError):
                release.update_text(text, TAG)

    def test_version_looking_text_outside_history_is_untouched(self):
        text = '| 0.1.2 | external table |\n\n' + self.text
        self.assertTrue(release.update_text(text, TAG).startswith('| 0.1.2 | external table |'))


class PackageTests(unittest.TestCase):
    def test_automatic_credentials_require_the_native_connector_and_bundled_client(self):
        extras = {'extension/backend/credential_native.py': b'native',
                  'extension/backend/credential_store.py': b'store',
                  'extension/backend/vendor/NOTICE.md': b'license notice',
                  'extension/backend/vendor/jeepney-0.9.0-py3-none-any.whl': b'client'}
        release.verify_vsix(package('0.4.1', extra=extras), 'v0.4.1')
        for missing in extras:
            incomplete = {k:v for k,v in extras.items() if k != missing}
            with self.assertRaises(ValueError):
                release.verify_vsix(package('0.4.1', extra=incomplete), 'v0.4.1')

    def test_manifest_identity_and_local_files_are_verified(self):
        release.verify_vsix(package(), TAG)
        for content in (package('0.1.1'), package(extra={'extension/.env': b'secret'}),
                        package(extra={'extension/key.dpapi': b'credential'})):
            with self.assertRaises(ValueError):
                release.verify_vsix(content, TAG)

    def test_zip_timestamp_differences_do_not_require_overwriting_an_asset(self):
        self.assertTrue(release.same_package(package(year=2025), package(year=2026)))
        self.assertFalse(release.same_package(package(), package(extra={'extension/extension.js': b'different'})))

    def test_tag_must_be_annotated_and_manifest_must_match(self):
        with patch.object(release, 'api', return_value={'object': {'type': 'commit', 'sha': SHA}}):
            with self.assertRaisesRegex(ValueError, 'annotated'):
                release.verified_commit(TAG)
        def api(method, path, data=None):
            if '/git/ref/' in path:
                return {'object': {'type': 'tag', 'sha': 'b'*40}}
            if '/git/tags/' in path:
                return {'object': {'type': 'commit', 'sha': SHA}}
            if '/compare/' in path:
                return {'merge_base_commit': {'sha': SHA}}
            return {'content': base64.b64encode(b'{"version":"0.1.1"}').decode()}
        with patch.object(release, 'api', side_effect=api):
            with self.assertRaisesRegex(ValueError, 'Manifest'):
                release.verified_commit(TAG)


class PublicationTests(unittest.TestCase):
    def test_trusted_workflow_resolves_only_the_matching_merged_tag(self):
        head = 'b' * 40
        metadata = {'schema': 1, 'tagPrefix': 'v', 'mainBranch': 'main', 'branch': 'fix/logo', 'version': '0.1.2'}
        pr = {'merged': True, 'merge_commit_sha': SHA, 'head': {'sha': head, 'ref': 'fix/logo', 'repo': {'full_name': release.REPO}}, 'body': '<!-- release-metadata '+json.dumps(metadata)+' -->'}
        def api(method, path, data=None):
            if '/actions/runs/' in path:
                return {'conclusion': 'success', 'event': 'pull_request_target', 'path': '.github/workflows/version-release.yml', 'head_repository': {'full_name': release.REPO}, 'head_sha': head}
            if '/commits/' in path:
                return [{'merged_at': '2026-11-07', 'base': {'ref': 'main'}, 'number': 2}]
            return pr
        with patch.object(release, 'api', side_effect=api), patch.object(release, 'verified_commit', return_value=SHA), patch.object(release, 'release_for', return_value=None):
            result = release.resolve({'repository': {'full_name': release.REPO}, 'workflow_run': {'id': 4}})
        self.assertEqual(result, {'skip': 'false', 'tag': TAG, 'sha': SHA, 'version': '0.1.2'})

    def test_partial_release_refuses_to_replace_a_different_existing_vsix(self):
        previous = package(extra={'extension/extension.js': b'different'})
        record = {'draft': True, 'assets': [{'id': 1, 'name': release.names(TAG)[0]}]}
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory)/release.names(TAG)[0]).write_bytes(package())
            with patch.object(release, 'verified_commit', return_value=SHA), patch.object(release, 'release_for', return_value=record), patch.object(release, 'api', return_value=previous) as api:
                with self.assertRaisesRegex(ValueError, 'different VSIX'):
                    release.publish(TAG, Path(directory))
                self.assertTrue(all(call.args[0] == 'GET' for call in api.call_args_list))

    def test_complete_publication_and_retries_never_replace_assets(self):
        state = {'release': None, 'bytes': {}, 'writes': []}
        def api(method, path, data=None, binary=False):
            if method == 'POST' and path == '/releases':
                state['release'] = {'id': 1, 'tag_name': TAG, 'draft': True, 'assets': [], 'upload_url': 'https://uploads.github.com/assets{?name}'}
            elif method == 'POST' and 'uploads.github.com' in path:
                name = path.split('name=')[1]
                asset_id = len(state['bytes']) + 1
                state['bytes'][asset_id] = data
                state['release']['assets'].append({'id': asset_id, 'name': name, 'digest': 'sha256:'+hashlib.sha256(data).hexdigest()})
            elif method == 'GET' and '/assets/' in path:
                return state['bytes'][int(path.rsplit('/', 1)[1])]
            elif method == 'PATCH':
                state['release'].update(data)
            if method != 'GET':
                state['writes'].append((method, path))
            return copy.deepcopy(state['release'])
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory)/release.names(TAG)[0]
            file.write_bytes(package())
            with patch.object(release, 'verified_commit', return_value=SHA), patch.object(release, 'release_for', side_effect=lambda _: copy.deepcopy(state['release'])), patch.object(release, 'api', side_effect=api):
                self.assertEqual(release.publish(TAG, Path(directory))['status'], 'published')
                self.assertFalse(state['release']['draft'])
                self.assertEqual(len(state['release']['assets']), 2)
                writes = len(state['writes'])
                self.assertEqual(release.publish(TAG, Path(directory))['status'], 'existing')
                self.assertEqual(len(state['writes']), writes)

    def test_untrusted_workflow_run_is_rejected(self):
        event = {'repository': {'full_name': release.REPO}, 'workflow_run': {'id': 4}}
        run = {'conclusion': 'success', 'event': 'pull_request', 'path': '.github/workflows/other.yml', 'head_repository': {'full_name': release.REPO}}
        with patch.object(release, 'api', return_value=run):
            with self.assertRaisesRegex(ValueError, 'trusted'):
                release.resolve(event)

    def test_readme_is_not_updated_before_release_is_published(self):
        with patch.object(release, 'verified_commit', return_value=SHA), patch.object(release, 'release_for', return_value={'draft': True}), patch.object(release, 'api') as api:
            with self.assertRaises(ValueError):
                release.update_readme(TAG)
            api.assert_not_called()

    def test_readme_conflict_reloads_main_without_losing_new_content(self):
        calls = []
        reads = 0
        def api(method, path, data=None):
            nonlocal reads
            if method == 'GET':
                reads += 1
                text = HistoryTests.text + ('New concurrent content.\n' if reads > 1 else '')
                return {'sha': str(reads), 'content': base64.b64encode(text.encode()).decode()}
            calls.append(data)
            if len(calls) == 1:
                raise urllib.error.HTTPError(path, 409, 'conflict', {}, None)
            return {'commit': {'sha': SHA}}
        with patch.object(release, 'verified_commit', return_value=SHA), patch.object(release, 'release_for', return_value={'draft': False}), patch.object(release, 'verify_published'), patch.object(release, 'api', side_effect=api):
            release.update_readme(TAG)
        self.assertIn('New concurrent content.', base64.b64decode(calls[-1]['content']).decode())


if __name__ == '__main__':
    unittest.main()
