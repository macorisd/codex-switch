"""Publish verified tagged VSIX packages and link their README history rows."""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request
import zipfile

REPO = 'macorisd/codex-switch'
TAG = re.compile(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z')
MARKER = re.compile(r'<!-- release-metadata (\{[^\r\n]*\}) -->')


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected:
            redirected.remove_header('Authorization')
        return redirected


def api(method, path, data=None, binary=False):
    url = path if path.startswith('https://') else f'https://api.github.com/repos/{REPO}{path}'
    if urllib.parse.urlparse(url).hostname not in ('api.github.com', 'uploads.github.com'):
        raise ValueError('Unexpected GitHub destination')
    headers = {'Authorization': 'Bearer ' + os.environ['GITHUB_TOKEN'],
               'Accept': 'application/octet-stream' if binary else 'application/vnd.github+json',
               'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'codex-switch-release'}
    if isinstance(data, bytes):
        headers['Content-Type'] = 'application/octet-stream'
    elif data is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(data).encode()
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.build_opener(SafeRedirect()).open(request, timeout=120) as response:
        return response.read() if binary else json.load(response)


def version(tag):
    if not TAG.fullmatch(tag):
        raise ValueError('Expected a version tag such as v0.1.2')
    return tag[1:]


def names(tag):
    return f'codex-switch-{version(tag)}.vsix', f'codex-switch-{version(tag)}.vsix.sha256'


def verified_commit(tag):
    version(tag)
    obj = api('GET', f'/git/ref/tags/{tag}')['object']
    if obj['type'] != 'tag':
        raise ValueError('Expected an annotated version tag')
    commit = api('GET', f'/git/tags/{obj["sha"]}')['object']
    if commit['type'] != 'commit' or not re.fullmatch('[a-f0-9]{40}', commit['sha']):
        raise ValueError('Tag must resolve directly to a commit')
    sha = commit['sha']
    comparison = api('GET', f'/compare/{sha}...main')
    if comparison.get('merge_base_commit', {}).get('sha') != sha:
        raise ValueError('Tag does not belong to main')
    manifest = api('GET', f'/contents/package.json?ref={sha}')
    package = json.loads(base64.b64decode(manifest['content']))
    if package.get('version') != version(tag):
        raise ValueError('Manifest version does not match the tag')
    return sha


def release_for(tag):
    try:
        return api('GET', f'/releases/tags/{tag}')
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        error.close()
    # Draft releases are omitted from the tag endpoint.
    page = 1
    while True:
        releases = api('GET', f'/releases?per_page=100&page={page}')
        matches = [item for item in releases if item['tag_name'] == tag]
        if matches:
            if len(matches) != 1:
                raise ValueError('Ambiguous release')
            return matches[0]
        if len(releases) < 100:
            return None
        page += 1


def verify_vsix(content, tag):
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        files = archive.namelist()
        if len(files) != len(set(files)):
            raise ValueError('Duplicate VSIX entries')
        manifest = json.loads(archive.read('extension/package.json'))
        if (manifest.get('name') != 'codex-provider-switch'
                or manifest.get('publisher') != 'macor-local'
                or manifest.get('version') != version(tag)):
            raise ValueError('VSIX identity/version does not match the release')
        if any(name.endswith(('.dpapi', '.toml.bak')) or Path(name).name in
               ('auth.json', 'config.toml', '.env', 'previous-settings.json') for name in files):
            raise ValueError('VSIX contains local credential or configuration files')
        for name in ('extension/extension.js', 'extension/backend/bridge.py',
                     'extension/backend/credential_helper.py'):
            if name not in files:
                raise ValueError('VSIX is missing its bundled connector')


def checksum(content, name):
    return f'{hashlib.sha256(content).hexdigest()}  {name}\n'.encode('ascii')


def verify_published(release, tag):
    if release.get('tag_name') != tag:
        raise ValueError('Release tag mismatch')
    name, digest_name = names(tag)
    assets = {asset['name']: asset for asset in release['assets']}
    if name not in assets or digest_name not in assets:
        raise ValueError('Release is missing VSIX/checksum')
    digest = assets[name].get('digest', '')
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', digest):
        raise ValueError('Missing VSIX digest')
    expected = f'{digest[7:]}  {name}\n'.encode('ascii')
    actual = api('GET', f'/releases/assets/{assets[digest_name]["id"]}', binary=True)
    if actual != expected:
        raise ValueError('Published checksum does not match GitHub asset digest')


def resolve(event):
    if event['repository']['full_name'] != REPO:
        raise ValueError('Unexpected repository')
    if 'workflow_run' in event:
        run = api('GET', f'/actions/runs/{int(event["workflow_run"]["id"])}')
        if (run['conclusion'] != 'success' or run['event'] != 'pull_request_target'
                or run['path'] != '.github/workflows/version-release.yml'
                or run['head_repository']['full_name'] != REPO):
            raise ValueError('Expected a trusted successful tag workflow')
        candidates = api('GET', f'/commits/{run["head_sha"]}/pulls?per_page=100')
        tags = set()
        for candidate in candidates:
            if not candidate.get('merged_at') or candidate['base']['ref'] != 'main':
                continue
            pr = api('GET', f'/pulls/{int(candidate["number"])}')
            markers = MARKER.findall(pr.get('body') or '')
            if (not pr.get('merged') or pr['head']['sha'] != run['head_sha']
                    or pr['head']['repo']['full_name'] != REPO or len(markers) != 1):
                continue
            metadata = json.loads(markers[0])
            if (metadata.get('schema') != 1 or metadata.get('tagPrefix') != 'v'
                    or metadata.get('mainBranch') != 'main' or metadata.get('branch') != pr['head']['ref']):
                raise ValueError('Invalid release metadata')
            tag = 'v' + metadata['version']
            if verified_commit(tag) != pr['merge_commit_sha']:
                raise ValueError('Tag and merged PR do not match')
            tags.add(tag)
        if not tags:
            return {'skip': 'true'}
        if len(tags) != 1:
            raise ValueError('Ambiguous release association')
        tag = tags.pop()
    else:
        tag = event['inputs']['tag']
    sha = verified_commit(tag)
    existing = release_for(tag)
    skip = False
    if existing and not existing.get('draft'):
        try:
            verify_published(existing, tag)
            skip = True
        except ValueError:
            pass  # Existing release without assets can be completed.
    return {'skip': str(skip).lower(), 'tag': tag, 'sha': sha, 'version': version(tag)}


def same_package(left, right):
    # ZIP timestamps may differ on retry. Preserve the first uploaded artifact
    # when the file names and all uncompressed contents are exactly identical.
    with zipfile.ZipFile(io.BytesIO(left)) as a, zipfile.ZipFile(io.BytesIO(right)) as b:
        return set(a.namelist()) == set(b.namelist()) and all(a.read(n) == b.read(n) for n in a.namelist())


def publish(tag, directory):
    sha = verified_commit(tag)
    if os.environ.get('RELEASE_SHA') and os.environ['RELEASE_SHA'] != sha:
        raise ValueError('Tag changed after resolution')
    name, digest_name = names(tag)
    content = (directory / name).read_bytes()
    verify_vsix(content, tag)
    release = release_for(tag)
    if release and not release.get('draft'):
        try:
            verify_published(release, tag)
            return {'status': 'existing', 'tag': tag}
        except ValueError:
            pass
    if release is None:
        release = api('POST', '/releases', {
            'tag_name': tag, 'name': f'codex-switch {version(tag)}', 'draft': True,
            'prerelease': False, 'body': f'Install the attached VSIX in VS Code using **Extensions: Install from VSIX**.\n\n'
            f'Changes: [version history](https://github.com/{REPO}/blob/{tag}/README.md).\n'
            'The SHA-256 file verifies download integrity.',
        })
    assets = {asset['name']: asset for asset in release['assets']}
    if name in assets:
        previous = api('GET', f'/releases/assets/{assets[name]["id"]}', binary=True)
        if not same_package(previous, content):
            raise ValueError('A different VSIX already exists; refusing to replace it')
        content = previous
    expected = checksum(content, name)
    for filename, data in ((name, content), (digest_name, expected)):
        if filename in assets:
            if assets[filename].get('digest') != 'sha256:' + hashlib.sha256(data).hexdigest():
                raise ValueError('A different asset already exists; refusing to replace it')
            continue
        api('POST', release['upload_url'].split('{')[0] + '?name=' + urllib.parse.quote(filename), data)
    complete = api('GET', f'/releases/{release["id"]}')
    verify_published(complete, tag)
    if complete.get('draft'):
        api('PATCH', f'/releases/{release["id"]}', {'draft': False})
    return {'status': 'published', 'tag': tag}


def update_text(text, tag):
    label = re.escape(version(tag))
    header = '| Version | Changes |'
    if text.count(header) != 1:
        raise ValueError('Expected one version history table')
    start = text.index(header) + len(header)
    tail = text[start:]
    lines = tail.splitlines(keepends=True)
    # Only the contiguous table immediately after the known header is editable.
    count = 0
    for index, line in enumerate(lines):
        if index == 0 and not line.strip():
            continue
        if not line.startswith('|'):
            break
        match = re.match(rf'^\| (?:{label}(?: \(unreleased\))?|\[{label}\]\([^)]+\)) \|', line)
        if match:
            end = line.index(' |', 2)
            lines[index] = f'| [{version(tag)}](https://github.com/{REPO}/releases/tag/{tag})' + line[end:]
            count += 1
    if count != 1:
        raise ValueError('Expected one matching version history row')
    return text[:start] + ''.join(lines)


def update_readme(tag):
    sha = verified_commit(tag)
    if os.environ.get('RELEASE_SHA') and os.environ['RELEASE_SHA'] != sha:
        raise ValueError('Tag changed after resolution')
    release = release_for(tag)
    if not release or release.get('draft'):
        raise ValueError('README requires an already published release')
    verify_published(release, tag)
    for attempt in range(3):
        record = api('GET', '/contents/README.md?ref=main')
        original = base64.b64decode(record['content']).decode('utf-8')
        updated = update_text(original, tag)
        if original == updated:
            return {'status': 'unchanged', 'tag': tag}
        try:
            result = api('PUT', '/contents/README.md', {
                'branch': 'main', 'sha': record['sha'],
                'message': f'docs: link published VSIX release {tag}',
                'content': base64.b64encode(updated.encode()).decode('ascii'),
            })
            return {'status': 'updated', 'tag': tag, 'commit': result['commit']['sha']}
        except urllib.error.HTTPError as error:
            error.close()
            if error.code != 409 or attempt == 2:
                raise
    raise AssertionError('Unreachable')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['resolve', 'publish', 'readme'])
    parser.add_argument('--tag')
    parser.add_argument('--directory', type=Path, default=Path('release-assets'))
    args = parser.parse_args()
    if args.command == 'resolve':
        result = resolve(json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text('utf-8')))
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
                output.write(''.join(f'{key}={value}\n' for key, value in result.items()))
    elif args.command == 'publish':
        result = publish(args.tag, args.directory)
    else:
        result = update_readme(args.tag)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
