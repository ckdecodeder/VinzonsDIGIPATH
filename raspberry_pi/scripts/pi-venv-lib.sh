#!/usr/bin/env bash
# Shared venv helpers for Pi (Debian ensurepip is often disabled).
# Usage: source "$(dirname "$0")/pi-venv-lib.sh"

pi_bootstrap_venv_pip() {
  local py="$1"
  local label="${2:-Pi}"

  if "$py" -m pip --version >/dev/null 2>&1; then
    return 0
  fi

  echo "[$label] Bootstrapping pip inside .venv..."
  if "$py" -m ensurepip --upgrade --default-pip 2>/dev/null; then
    return 0
  fi

  echo "[$label] ensurepip unavailable — using get-pip.py..."
  local tmp
  tmp="$(mktemp /tmp/get-pip.XXXXXX.py)"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://bootstrap.pypa.io/get-pip.py -o "$tmp"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$tmp" https://bootstrap.pypa.io/get-pip.py
  else
    echo "[$label] ERROR: need curl or wget to bootstrap pip"
    rm -f "$tmp"
    return 1
  fi

  "$py" "$tmp" --no-warn-script-location
  rm -f "$tmp"

  if ! "$py" -m pip --version >/dev/null 2>&1; then
    echo "[$label] ERROR: pip bootstrap failed — try: sudo apt install python3-pip python3-venv"
    return 1
  fi
}

pi_python_for_venv() {
  # aiortc + stdlib audioop work best on 3.12; 3.13 needs audioop-lts backport.
  if command -v python3.12 >/dev/null 2>&1; then
    if python3.12 -c 'import sys; exit(0 if sys.version_info[:2] == (3, 12) else 1)' 2>/dev/null; then
      echo python3.12
      return 0
    fi
  fi
  echo python3
}

pi_ensure_venv() {
  local root="$1"
  local label="${2:-Pi}"
  local venv_py="$root/.venv/bin/python"
  local py_cmd
  py_cmd="$(pi_python_for_venv)"

  if [[ -d "$root/.venv" ]]; then
    if [[ ! -x "$venv_py" ]]; then
      echo "[$label] Broken .venv (no bin/python) — removing..."
      sudo rm -rf "$root/.venv" 2>/dev/null || rm -rf "$root/.venv"
    elif ! grep -q "include-system-site-packages = true" "$root/.venv/pyvenv.cfg" 2>/dev/null; then
      echo "[$label] Recreating .venv with system-site-packages..."
      sudo rm -rf "$root/.venv" 2>/dev/null || rm -rf "$root/.venv"
    fi
  fi

  if [[ ! -d "$root/.venv" ]]; then
    if [[ "$py_cmd" == python3.12 ]]; then
      echo "[$label] Creating .venv with python3.12 (better aiortc compat than 3.13)..."
    else
      echo "[$label] Creating .venv (--system-site-packages --without-pip)..."
    fi
    if ! "$py_cmd" -m venv --system-site-packages --without-pip "$root/.venv"; then
      echo "[$label] venv failed — installing python3-full..."
      if [[ "$py_cmd" == python3.12 ]]; then
        sudo apt-get install -y python3.12-venv python3.12-full python3.12-dev 2>/dev/null || true
      else
        sudo apt-get install -y python3-full python3-venv python3-pip 2>/dev/null || true
      fi
      "$py_cmd" -m venv --system-site-packages --without-pip "$root/.venv"
    fi
  fi

  if [[ ! -x "$venv_py" ]]; then
    echo "[$label] ERROR: venv creation failed — run: sudo apt install python3-venv python3-pip"
    return 1
  fi

  pi_bootstrap_venv_pip "$venv_py" "$label"
}
