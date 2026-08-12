#!/usr/bin/env bash
# Shared helpers for Pi install scripts.
# shellcheck shell=bash

pi_detect_dest() {
  local run_user="${1:-}"
  local user_home=""
  local candidate=""

  if [[ -n "${DIGIPATH_WS_DIR:-}" && -f "${DIGIPATH_WS_DIR}/pi_ws_scanner.py" ]]; then
    echo "${DIGIPATH_WS_DIR}"
    return 0
  fi

  if [[ -n "$run_user" ]]; then
    user_home="$(getent passwd "$run_user" | cut -d: -f6)"
    if [[ -n "$user_home" && -f "$user_home/Desktop/VinzonsDIGIPATH-Pi/pi_ws_scanner.py" ]]; then
      echo "$user_home/Desktop/VinzonsDIGIPATH-Pi"
      return 0
    fi
  fi

  for candidate in digipath digipathberry pi; do
    user_home="$(getent passwd "$candidate" | cut -d: -f6 2>/dev/null || true)"
    if [[ -n "$user_home" && -f "$user_home/Desktop/VinzonsDIGIPATH-Pi/pi_ws_scanner.py" ]]; then
      echo "$user_home/Desktop/VinzonsDIGIPATH-Pi"
      return 0
    fi
  done

  return 1
}

pi_detect_run_user() {
  local dest="${1:-}"

  if [[ -n "${DIGIPATH_USER:-}" ]]; then
    echo "${DIGIPATH_USER}"
    return 0
  fi

  if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != root ]]; then
    echo "${SUDO_USER}"
    return 0
  fi

  if [[ -n "$dest" ]]; then
  local owner=""
    owner="$(stat -c '%U' "$dest" 2>/dev/null || true)"
    if [[ -n "$owner" && "$owner" != root ]]; then
      echo "$owner"
      return 0
    fi
  fi

  for candidate in digipath digipathberry pi; do
    if id "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done

  echo "digipath"
}
