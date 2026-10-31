"""The key ``trendsfast login`` stores, read after ``TRENDSFAST_API_KEY``.

Path: ``${XDG_CONFIG_HOME:-~/.config}/trendsfast/credentials.json`` (the same file the CLI
writes). The key is never logged or printed; only its visible prefix may be shown.
"""
import json
import re
from pathlib import Path
from typing import Any, Mapping, Optional


def home_directory(env: Mapping[str, str]) -> Path:
    return Path(env.get("HOME") or env.get("USERPROFILE") or str(Path.home()))


def config_directory(env: Mapping[str, str]) -> Path:
    base = (env.get("XDG_CONFIG_HOME") or "").strip()
    return (Path(base) if base else home_directory(env) / ".config") / "trendsfast"


def credentials_path(env: Mapping[str, str]) -> Path:
    return config_directory(env) / "credentials.json"


def read_stored_credentials(path: Path) -> Optional[dict]:
    """The stored credentials, or None when there are none or the file is unreadable."""
    try:
        raw: Any = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict) or not isinstance(raw.get("api_key"), str) or not raw["api_key"]:
        return None
    return raw


def key_prefix(api_key: str) -> str:
    """``tf_live_AbCd1234`` from a full key: the part TrendsFast's dashboard shows."""
    match = re.match(r"^(tf_(?:test|live)_[A-Za-z0-9_-]{8,32})\.", api_key)
    return match.group(1) if match else "(not a TrendsFast key)"


__all__ = ["config_directory", "credentials_path", "home_directory", "key_prefix", "read_stored_credentials"]
