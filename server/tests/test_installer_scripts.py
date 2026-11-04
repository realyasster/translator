from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


def _run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=120,
    )


def test_powershell_installer_parses() -> None:
    powershell = shutil.which("powershell") or shutil.which("pwsh")
    if powershell is None:
        pytest.skip("PowerShell is not available")
    script = REPO_ROOT / "scripts" / "install-ct2-server.ps1"
    command = (
        "$errors = $null; "
        "[System.Management.Automation.Language.Parser]::ParseFile("
        f"'{script}', [ref]$null, [ref]$errors) | Out-Null; "
        "if ($errors.Count -gt 0) { "
        "$errors | ForEach-Object { $_.Message }; exit 1 }"
    )
    completed = _run([powershell, "-NoProfile", "-Command", command])
    assert completed.returncode == 0, completed.stdout + completed.stderr


def test_shell_installer_parses() -> None:
    bash = shutil.which("bash")
    # Windows ships a WSL stub under System32 that cannot access repo paths.
    if bash is None or "system32" in bash.lower():
        pytest.skip("A POSIX bash is not available")
    script = REPO_ROOT / "scripts" / "install-ct2-server.sh"
    completed = _run([bash, "-n", str(script)])
    assert completed.returncode == 0, completed.stdout + completed.stderr


def test_powershell_installer_guards_exit_inside_iex() -> None:
    powershell = shutil.which("powershell") or shutil.which("pwsh")
    if powershell is None:
        pytest.skip("PowerShell is not available")
    script = REPO_ROOT / "scripts" / "install-ct2-server.ps1"
    command = (
        "$tokens = $null; $errors = $null; "
        "$ast = [System.Management.Automation.Language.Parser]::ParseFile("
        f"'{script}', [ref]$tokens, [ref]$errors); "
        "$exits = $ast.FindAll({ param($node) $node -is "
        "[System.Management.Automation.Language.ExitStatementAst] }, $true); "
        "foreach ($item in $exits) { "
        "$parent = $item.Parent; $guarded = $false; "
        "while ($parent) { "
        "if ($parent -is "
        "[System.Management.Automation.Language.IfStatementAst] -and "
        "$parent.Clauses[0].Item1.Extent.Text -match 'Ct2ScriptRoot') { "
        "$guarded = $true; break }; "
        "$parent = $parent.Parent }; "
        "if (-not $guarded) { "
        "Write-Output ('unguarded exit at line ' + $item.Extent.StartLineNumber); "
        "exit 1 } }; "
        "Write-Output 'exit statements guarded'"
    )
    completed = _run([powershell, "-NoProfile", "-Command", command])
    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert "exit statements guarded" in completed.stdout
