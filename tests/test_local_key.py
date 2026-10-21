"""Private final-binary insertion is tested only with synthetic dummy keys."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.local.launcher import executable_config


MODULE = Path(__file__).resolve().parents[1] / 'scripts' / 'embed_local_key.py'
spec = importlib.util.spec_from_file_location('embed_local_key', MODULE)
embedder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(embedder)
DUMMY_KEY = 'sk-synthetic-test-token-never-valid-for-an-api'


def test_key_changes_only_final_binary_and_public_manifest(tmp_path):
    executable = tmp_path / 'BotAI-Local'
    executable.write_bytes(b'fake native executable')
    public = tmp_path / 'prompt.md'
    public.write_text('Approved instructions', encoding='utf-8')
    manifest = tmp_path / 'manifest.json'
    manifest.write_text(json.dumps({'files': {executable.name: 'old-checksum', public.name: 'public-checksum'}}), encoding='utf-8')
    initial = set(tmp_path.iterdir())
    embedder.embed(executable, DUMMY_KEY)
    assert set(tmp_path.iterdir()) == initial
    assert executable_config(executable) == {'api_key': DUMMY_KEY}
    assert public.read_text(encoding='utf-8') == 'Approved instructions'
    assert DUMMY_KEY not in manifest.read_text(encoding='utf-8')
    assert json.loads(manifest.read_text())['files'][executable.name] != 'old-checksum'
    assert embedder.scan([tmp_path], {executable.resolve()}, DUMMY_KEY) == (2, [], [])


def test_existing_key_refuses_replacement_without_mutating_binary(tmp_path):
    executable = tmp_path / 'BotAI-Local'
    executable.write_bytes(b'fake native executable')
    embedder.embed(executable, DUMMY_KEY)
    before = executable.read_bytes()
    with pytest.raises(ValueError, match='already contains'):
        embedder.embed(executable, 'sk-other-synthetic-token')
    assert executable.read_bytes() == before


def test_empty_existing_trailer_refuses_append(tmp_path):
    executable = tmp_path / 'BotAI-Local'
    payload = b'{}'
    original = (b'fake executable' + embedder.CONFIG_START + payload +
                len(payload).to_bytes(8, 'big') + embedder.CONFIG_END)
    executable.write_bytes(original)
    with pytest.raises(ValueError, match='already contains'):
        embedder.embed(executable, DUMMY_KEY)
    assert executable.read_bytes() == original


def test_scanner_finds_key_across_chunk_boundary_without_echoing_it(tmp_path, capsys):
    leak = tmp_path / 'unexpected-copy.bin'
    leak.write_bytes(b'x' * (1024 * 1024 - 5) + DUMMY_KEY.encode() + b'padding')
    clean = tmp_path / 'public.md'
    clean.write_text('Public data', encoding='utf-8')
    checked, leaks, unreadable = embedder.scan([tmp_path, tmp_path], set(), DUMMY_KEY)
    assert checked == 2 and leaks == [leak.resolve()] and unreadable == []
    assert DUMMY_KEY not in capsys.readouterr().out


def test_scanner_reports_unreadable_files_instead_of_claiming_clean(tmp_path, monkeypatch):
    path = tmp_path / 'unreadable.bin'
    path.write_bytes(b'contents')

    def unavailable(*_):
        raise PermissionError('Permission denied')

    monkeypatch.setattr(embedder, 'contains_key', unavailable)
    assert embedder.scan([tmp_path], set(), DUMMY_KEY) == (0, [], [path.resolve()])


def test_cli_uses_hidden_terminal_input_and_does_not_read_env_key(tmp_path, monkeypatch, capsys):
    executable = tmp_path / 'BotAI-Local'
    executable.write_bytes(b'fake native executable')
    monkeypatch.setenv('BOTAI_LOCAL_API_KEY', 'sk-unrelated-environment-token')
    monkeypatch.setattr(embedder.sys, 'stdin', SimpleNamespace(isatty=lambda: True))
    prompts = []

    def input_key(prompt):
        prompts.append(prompt)
        return DUMMY_KEY

    monkeypatch.setattr(embedder.getpass, 'getpass', input_key)
    assert embedder.main([str(executable), '--scan', str(tmp_path)]) == 0
    assert prompts and executable_config(executable)['api_key'] == DUMMY_KEY
    captured = capsys.readouterr()
    assert DUMMY_KEY not in captured.out + captured.err
    assert set(tmp_path.iterdir()) == {executable}


def test_cli_refuses_nonterminal_input_without_reading_or_mutating(tmp_path, monkeypatch, capsys):
    executable = tmp_path / 'BotAI-Local'
    executable.write_bytes(b'fake native executable')
    before = executable.read_bytes()
    monkeypatch.setattr(embedder.sys, 'stdin', SimpleNamespace(isatty=lambda: False))

    def unexpected_input(_):
        pytest.fail('A key must not be read from nonterminal input')

    monkeypatch.setattr(embedder.getpass, 'getpass', unexpected_input)
    assert embedder.main([str(executable), '--scan', str(tmp_path)]) == 1
    assert executable.read_bytes() == before
    assert 'Traceback' not in capsys.readouterr().err


def test_missing_executable_is_a_clean_error(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(embedder.sys, 'stdin', SimpleNamespace(isatty=lambda: True))
    monkeypatch.setattr(embedder.getpass, 'getpass', lambda _: DUMMY_KEY)
    assert embedder.main([str(tmp_path / 'missing-executable')]) == 1
    captured = capsys.readouterr()
    assert DUMMY_KEY not in captured.out + captured.err and 'Traceback' not in captured.err


def test_invalid_key_errors_do_not_echo_input(tmp_path, monkeypatch, capsys):
    executable = tmp_path / 'BotAI-Local'
    executable.write_bytes(b'fake native executable')
    monkeypatch.setattr(embedder.sys, 'stdin', SimpleNamespace(isatty=lambda: True))
    secret_input = 'invalid secret input must never appear in logs'
    monkeypatch.setattr(embedder.getpass, 'getpass', lambda _: secret_input)
    assert embedder.main([str(executable), '--scan', str(tmp_path)]) == 1
    captured = capsys.readouterr()
    assert secret_input not in captured.out + captured.err
    assert executable.read_bytes() == b'fake native executable'


def test_verify_only_scans_without_prompting_or_mutating(tmp_path, monkeypatch, capsys):
    executable = tmp_path / 'BotAI-Local'
    executable.write_bytes(b'fake native executable')
    embedder.embed(executable, DUMMY_KEY)
    before = executable.read_bytes()
    leak = tmp_path / 'unintended-copy.txt'
    leak.write_text(DUMMY_KEY, encoding='utf-8')

    def unexpected_input(_):
        pytest.fail('Verification must not request another key')

    monkeypatch.setattr(embedder.getpass, 'getpass', unexpected_input)
    assert embedder.main([str(executable), '--verify-only', '--scan', str(tmp_path)]) == 1
    captured = capsys.readouterr()
    assert DUMMY_KEY not in captured.out + captured.err
    assert str(leak) in captured.out
    assert executable.read_bytes() == before
