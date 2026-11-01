#!/usr/bin/env python3
"""
Guard for agent commands and file edits (docs/AGENT_QA.md, G1 and G4).

Always: blocks what the isolation rule forbids anyway (git push, global
config and installs, writing the live data folder or release/).

During a QA run (.local/qa/ACTIVE exists): also blocks everything on the
never-do list. Every block is appended to .local/qa/attempts-agent.jsonl and,
during a run, to the run folder's copy.

Defence in depth: command text is matched by pattern, so it catches slips,
not determined evasion. QA app instances are held by QA mode in the app.

  python3 .cursor/hooks/qa_guard.py --selftest
"""
import json
import os
import re
import shlex
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
QA = os.path.join(ROOT, '.local', 'qa')
ACTIVE = os.path.join(QA, 'ACTIVE')

ALWAYS = [
    (r'\bgit\s+push\b', 'Never push: commits stay local.'),
    (r'\bgit\s+config\s+--global\b', 'Git identity is repo-local.'),
    (r'\bbrew\s+(install|upgrade|tap)\b', 'No global installs.'),
    (r'\bpip3?\s+install\b', 'No global installs.'),
    (r'\bnpm\s+(i|install|add)\b[^;&|]*\s(-g|--global)\b', 'No global installs.'),
    (r'(^|[;&|]\s*)(sudo)\b', 'No sudo.'),
]

DURING_RUN = [
    (r'\b(pkill|killall)\b[^;&|]*(AmbientMind|ambientmind|Electron)', 'Your running AmbientMind is off limits.'),
    (r'\bnpm\s+run\s+dist(:mac|:win)?\b', 'Packaged builds for QA go to .local/qa/build via npm run qa:build.'),
    # Only as a command (bare, via npx or a path), so reading its config is fine.
    (r'(^|[;&|(]\s*|\bnpx\s+|/)electron-builder(\s|$)(?![^;&|]*\.local/qa/build)', 'Packaged builds for QA go to .local/qa/build.'),
    (r'\bgit\s+(commit|checkout|switch|reset|stash|rebase|merge|cherry-pick|restore|clean|tag|am|apply)\b', 'Fixes are proposed as patches during a run, not applied.'),
    (r'\b(defaults\s+write|launchctl|osascript|tccutil|sfltool)\b', 'System settings are outside the repo.'),
    (r'(^|[;&|]\s*)security\s', 'The keychain is off limits.'),
    (r'(^|[;&|(]\s*)open\s', 'Opening apps, files or the browser would take over the screen.'),
    (r'\bclean-system\b', 'clean-system removes preferences your running app uses.'),
    (r'\bollama\s+pull\b', 'No model downloads during a run.'),
    (r'(/tmp/|\$TMPDIR|/private/var/folders/)', 'Scratch files go in .local/, never /tmp.'),
    (r'(^|\s|/)release/[^\s]*\s*$|\b(rm|mv|cp|ditto|rsync)\b[^;&|]*\brelease/', 'Your running app lives in release/.'),
]

WRITE_SQL = re.compile(r'\b(insert|update|delete|drop|alter|create|replace|vacuum|reindex|attach)\b|pragma\s+\w+\s*=', re.I)


def now():
    return datetime.now(timezone.utc).isoformat()


def run_dir():
    try:
        with open(ACTIVE) as f:
            path = f.read().strip()
        return path or None
    except OSError:
        return None


def running():
    return os.path.exists(ACTIVE)


def log(entry):
    entry = {'at': now(), **entry}
    targets = [os.path.join(QA, 'attempts-agent.jsonl')]
    current = run_dir()
    if current:
        targets.append(os.path.join(current, 'attempts-agent.jsonl'))
    for target in targets:
        try:
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, 'a') as f:
                f.write(json.dumps(entry) + '\n')
        except OSError:
            pass


def live_data_mention(command):
    """The live data folder may only be read with sqlite3 in read-only mode."""
    if '.local/data' not in command and not re.search(r'(^|\s)data/(ambientmind\.db|secrets\.json|config\.json)', command):
        return None
    for part in re.split(r'&&|\|\||;|\|', command):
        if '.local/data' not in part and 'data/ambientmind' not in part:
            continue
        readonly = re.search(r'\bsqlite3\b', part) and re.search(r'(mode=ro|immutable=1)', part) and not WRITE_SQL.search(part)
        listing = re.match(r'\s*(ls|du|wc|stat|test|\[)\b', part)
        if not (readonly or listing):
            return 'The live data folder is read-only for agents: sqlite3 with mode=ro or immutable=1, or ls/du/wc/stat.'
    return None


def rm_outside_qa(command):
    for match in re.finditer(r'(?:^|[;&|]\s*)rm\s+([^;&|]+)', command):
        try:
            args = shlex.split(match.group(1))
        except ValueError:
            return 'Could not read the rm arguments.'
        for arg in args:
            if arg.startswith('-'):
                continue
            path = os.path.normpath(os.path.join(ROOT, arg)) if not os.path.isabs(arg) else os.path.normpath(arg)
            if not path.startswith(QA + os.sep):
                return f'During a run, deletions go in cleanup.sh; rm may only touch .local/qa/ ({arg}).'
    return None


def check_command(command, during_run):
    for pattern, reason in ALWAYS:
        if re.search(pattern, command):
            return reason
    if during_run:
        reason = live_data_mention(command)
        if reason:
            return reason
        for pattern, why in DURING_RUN:
            if re.search(pattern, command):
                return why
        return rm_outside_qa(command)
    return None


def inside(path, folder):
    return path == folder or path.startswith(folder + os.sep)


def check_edit(path, during_run):
    if not path:
        return None
    full = os.path.normpath(path if os.path.isabs(path) else os.path.join(ROOT, path))
    if inside(full, os.path.join(ROOT, '.local', 'data')):
        return 'The live data folder is read-only for agents.'
    if inside(full, os.path.join(ROOT, 'release')):
        return 'Your running app lives in release/.'
    if during_run and not inside(full, QA):
        return 'During a run, nothing outside .local/qa/ is edited; fixes go in proposed-patches/.'
    return None


EDIT_TOOLS = {'Write', 'StrReplace', 'Delete', 'EditNotebook', 'Edit', 'MultiEdit'}


def decide(payload):
    event = payload.get('hook_event_name') or ('beforeShellExecution' if 'command' in payload else 'preToolUse')
    during_run = running()
    if event == 'beforeShellExecution':
        command = payload.get('command', '')
        reason = check_command(command, during_run)
        if reason:
            log({'event': event, 'command': command, 'reason': reason, 'run': during_run})
            return deny(reason)
        return {'permission': 'allow'}
    tool = payload.get('tool_name', '')
    if tool in EDIT_TOOLS:
        tool_input = payload.get('tool_input') or {}
        path = tool_input.get('path') or tool_input.get('file_path') or tool_input.get('target_notebook')
        reason = check_edit(path, during_run)
        if reason:
            log({'event': event, 'tool': tool, 'path': path, 'reason': reason, 'run': during_run})
            return deny(reason)
    return {'permission': 'allow'}


def deny(reason):
    return {
        'permission': 'deny',
        'user_message': f'Blocked by the QA guard: {reason}',
        'agent_message': f'The QA guard blocked this (docs/AGENT_QA.md §3): {reason} Record it as a finding instead of working around it.',
    }


def selftest():
    cases = [
        # (command, during_run, blocked?)
        ('git push origin main', False, True),
        ('git config --global user.name x', False, True),
        ('brew install idb-companion', False, True),
        ('./dev npm install -g something', False, True),
        ('./dev npm test', False, False),
        ('pkill -f "release/mac-arm64/AmbientMind.app/Contents/MacOS/AmbientMind$"', False, False),
        ('pkill -f "release/mac-arm64/AmbientMind.app/Contents/MacOS/AmbientMind$"', True, True),
        ('/usr/bin/sqlite3 "file:.local/data/ambientmind.db?immutable=1" "SELECT count(*) FROM tasks"', True, False),
        ('/usr/bin/sqlite3 "file:.local/data/ambientmind.db?mode=ro" "DELETE FROM tasks"', True, True),
        ('sqlite3 .local/data/ambientmind.db "UPDATE tasks SET status=1"', True, True),
        ('rm .local/data/secrets.json', True, True),
        ('cp x .local/data/config.json', True, True),
        ('ls -la .local/data', True, False),
        ('cd .local && rm data/ambientmind.db', True, True),
        ('rm -rf .local/qa/runs/old', True, False),
        ('rm -rf src/ui', True, True),
        ('./dev npm run dist:mac', True, True),
        ('./dev npm run qa:build', True, False),
        ('git commit -m x', True, True),
        ('git status --short', True, False),
        ('git diff --stat', True, False),
        ('defaults write com.ambientmind.app x 1', True, True),
        ('open https://example.com', True, True),
        ('./dev clean-system', True, True),
        ('echo hi > /tmp/x', True, True),
        ('rm -rf release/mac-arm64', True, True),
        ('./dev npm run qa -- --mission m1', True, False),
        ('rg -n "open" src', True, False),
        ('./dev run npx electron-builder --mac', True, True),
        ('node_modules/.bin/electron-builder --mac', True, True),
        ('electron-builder --mac --config.directories.output=.local/qa/build', True, False),
        ('rg -n identity package.json electron-builder.yml', True, False),
    ]
    edits = [
        ('.local/data/config.json', False, True),
        ('release/mac-arm64/x', False, True),
        ('src/ui/Orb.tsx', False, False),
        ('src/ui/Orb.tsx', True, True),
        ('.local/qa/runs/2026-11-02/report.md', True, False),
    ]
    failures = []
    for command, during, blocked in cases:
        got = check_command(command, during) is not None
        if got != blocked:
            failures.append(f'command {"(run)" if during else ""} {command!r}: blocked={got}, expected {blocked}')
    for path, during, blocked in edits:
        got = check_edit(path, during) is not None
        if got != blocked:
            failures.append(f'edit {"(run)" if during else ""} {path!r}: blocked={got}, expected {blocked}')
    for failure in failures:
        print('FAIL', failure)
    print(f'{len(cases) + len(edits) - len(failures)} passed, {len(failures)} failed')
    return 1 if failures else 0


def main():
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    try:
        payload = json.loads(sys.stdin.read() or '{}')
    except json.JSONDecodeError:
        print(json.dumps(deny('The hook could not read its input.')))
        return
    print(json.dumps(decide(payload)))


if __name__ == '__main__':
    main()
