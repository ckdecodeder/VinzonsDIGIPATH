#!/usr/bin/env bash
# Install aiortc inside project .venv (avoids PEP 668 externally-managed-environment).
# Usage: bash scripts/pi-install-webrtc.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
if [[ ! -f "$ROOT_DIR/pi_ws_scanner.py" && -f "$SCRIPT_DIR/../pi_ws_scanner.py" ]]; then
  ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
cd "$ROOT_DIR"

# shellcheck source=pi-venv-lib.sh
source "$SCRIPT_DIR/pi-venv-lib.sh"
# shellcheck source=pi-apt-lib.sh
source "$SCRIPT_DIR/pi-apt-lib.sh"

PIWHEELS="https://www.piwheels.org/simple"
ARCH="$(uname -m)"

purge_pip_av() {
  echo "[PiWebRTC] Removing pip PyAV (must use apt python3-av on Bookworm)..."
  "${PIP[@]}" uninstall -y av PyAV 2>/dev/null || true
  find "${ROOT_DIR}/.venv/lib" -maxdepth 4 -type d -name 'av' -path '*/site-packages/*' -exec rm -rf {} + 2>/dev/null || true
  find "${ROOT_DIR}/.venv/lib" -maxdepth 4 -type d -name 'av-*' -path '*/site-packages/*' -exec rm -rf {} + 2>/dev/null || true
  find "${ROOT_DIR}/.venv/lib" -maxdepth 4 -name 'av*.dist-info' -path '*/site-packages/*' -exec rm -rf {} + 2>/dev/null || true
}

verify_av() {
  "$PYTHON_BIN" - <<'PY'
import av
print(f"[PiWebRTC] av OK {av.__version__} from {av.__file__}")
PY
}

pip_one() {
  local pkg="$1"
  echo "[PiWebRTC] pip install --no-deps $pkg"
  "${PIP[@]}" install \
    --isolated \
    --no-cache-dir \
    --no-deps \
    --extra-index-url "$PIWHEELS" \
    --prefer-binary \
    --retries 5 \
    --timeout 300 \
    "$pkg"
}

install_audioop_compat() {
  # PEP 594: audioop removed in Python 3.13; aiortc still imports it at load time.
  local py_minor="${PY_VER##*.}"
  if [[ "${PY_VER%%.*}" -ne 3 || "$py_minor" -lt 13 ]]; then
    return 0
  fi
  if "$PYTHON_BIN" -c "import audioop" 2>/dev/null; then
    echo "[PiWebRTC] audioop already OK on Python $PY_VER"
    return 0
  fi
  echo "[PiWebRTC] Python ${PY_VER}: installing audioop-lts (stdlib audioop removed)..."
  if ! "${PIP[@]}" install --no-cache-dir --upgrade --retries 5 audioop-lts; then
    echo "[PiWebRTC] ERROR: audioop-lts pip install failed"
    return 1
  fi
  if ! "$PYTHON_BIN" -c "import audioop; print('[PiWebRTC] audioop from', getattr(audioop, '__file__', '?'))"; then
    echo "[PiWebRTC] ERROR: audioop still missing after audioop-lts on Python $PY_VER"
    return 1
  fi
  echo "[PiWebRTC] audioop-lts OK"
}

verify_aiortc() {
  "$PYTHON_BIN" - <<'PY'
import av
import aiortc
print(f"OK av={av.__version__} aiortc={aiortc.__version__}")
PY
}

diagnose_aiortc_import() {
  echo "[PiWebRTC] Import diagnostic:"
  "$PYTHON_BIN" - <<'PY' || true
import traceback
try:
    import av
    print("av OK", av.__version__, av.__file__)
except Exception:
    traceback.print_exc()
try:
    import aiortc
    print("aiortc OK", aiortc.__version__)
except Exception:
    traceback.print_exc()
PY
  echo "[PiWebRTC] libvpx on system:"
  ldconfig -p 2>/dev/null | grep -i vpx || true
}

fix_libvpx_runtime() {
  pi_apt_install_first_available PiWebRTC --skip-update libvpx9 libvpx8 libvpx7 libvpx6 || true
  sudo ldconfig 2>/dev/null || true
}

reinstall_aiortc_runtime_deps() {
  echo "[PiWebRTC] Refreshing aiortc runtime deps..."
  install_audioop_compat || true
  for pkg in google-crc32c pylibsrtp pyee ifaddr dnspython aioice cffi cryptography; do
    pip_one "$pkg" || true
  done
  purge_pip_av
}

try_verify_aiortc() {
  install_audioop_compat || true
  if verify_aiortc 2>/dev/null; then
    return 0
  fi
  diagnose_aiortc_import
  install_audioop_compat || true
  fix_libvpx_runtime
  reinstall_aiortc_runtime_deps
  verify_aiortc
}

purge_pip_aiortc() {
  "${PIP[@]}" uninstall -y aiortc 2>/dev/null || true
  find "${ROOT_DIR}/.venv/lib" -maxdepth 4 -type d -name 'aiortc' -path '*/site-packages/*' -exec rm -rf {} + 2>/dev/null || true
  find "${ROOT_DIR}/.venv/lib" -maxdepth 4 -type d -name 'aiortc-*' -path '*/site-packages/*' -exec rm -rf {} + 2>/dev/null || true
  find "${ROOT_DIR}/.venv/lib" -maxdepth 4 -name 'aiortc*.dist-info' -path '*/site-packages/*' -exec rm -rf {} + 2>/dev/null || true
}

build_aiortc_from_source() {
  local ver="${1:-1.6.0}"
  echo "[PiWebRTC] Building aiortc==${ver} from source (single CPU job, needs ~500MB free + swap)..."
  check_pi_resources

  if ! pi_python_has_headers "$PYTHON_BIN"; then
    echo "[PiWebRTC] Python.h missing for venv python $PY_VER — installing dev packages..."
    pi_apt_install_python_dev PiWebRTC "$PYTHON_BIN"
    if ! pi_python_has_headers "$PYTHON_BIN"; then
      echo "[PiWebRTC] ERROR: Python.h still missing for $PY_VER"
      echo "[PiWebRTC] Run: sudo apt install -y python${PY_VER}-dev python3-dev build-essential"
      return 1
    fi
  fi

  purge_pip_aiortc
  "${PIP[@]}" cache purge 2>/dev/null || true
  export MAX_JOBS=1
  export MAKEFLAGS="-j1"
  export TMPDIR="${TMPDIR:-/tmp}"
  if ! "${PIP[@]}" install \
    --isolated \
    --no-cache-dir \
    --no-binary aiortc \
    --no-deps \
    --verbose \
    "aiortc==${ver}"; then
    echo "[PiWebRTC] Source build failed (OSError often = disk full or out of RAM)."
    echo "  Fix: sudo dphys-swapfile swapoff && sudo dphys-swapfile swapon"
    echo "  Or:  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile"
    echo "  Then: df -h /tmp && bash scripts/pi-install-webrtc.sh"
    return 1
  fi
}

check_pi_resources() {
  echo "[PiWebRTC] Disk /tmp and project:"
  df -h /tmp "$ROOT_DIR" 2>/dev/null || df -h
  echo "[PiWebRTC] Memory:"
  free -h 2>/dev/null || true
}

install_aiortc_wheel() {
  local ver="${1:-1.6.0}"
  echo "[PiWebRTC] Trying aiortc==${ver} wheel from piwheels..."
  purge_pip_aiortc
  if pip_one "aiortc==${ver}"; then
    return 0
  fi
  echo "[PiWebRTC] piwheels wheel failed — trying PyPI binary wheel..."
  "${PIP[@]}" install \
    --no-cache-dir \
    --no-deps \
    --only-binary :all: \
    --retries 3 \
    --timeout 300 \
    "aiortc==${ver}" 2>/dev/null && return 0
  return 1
}

echo "[PiWebRTC] Root: $ROOT_DIR"
echo "[PiWebRTC] arch=$ARCH"

echo "[PiWebRTC] Installing system libraries..."
pi_apt_install_missing PiWebRTC \
  python3 python3-venv python3-pip python3-full python3-dev \
  python3-av python3-cffi python3-cryptography ffmpeg pkg-config \
  libavcodec-dev libavformat-dev libavutil-dev libswresample-dev \
  libswscale-dev libavfilter-dev libavdevice-dev \
  libopus-dev libopus0 libsrtp2-dev libsrtp2-1 libssl-dev libffi-dev build-essential \
  libvpx-dev

# libvpx runtime name differs: Bookworm=libvpx7, newer Pi OS / Trixie=libvpx9 or libvpx8
pi_apt_install_first_available PiWebRTC --skip-update libvpx9 libvpx8 libvpx7 libvpx6 || \
  echo "[PiWebRTC] WARN: libvpx runtime not installed — aiortc wheel may still work on $ARCH"
fix_libvpx_runtime

pi_ensure_venv "$ROOT_DIR" "PiWebRTC"

PYTHON_BIN="${ROOT_DIR}/.venv/bin/python"
PIP=( "$PYTHON_BIN" -m pip )

PY_VER="$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
echo "[PiWebRTC] Using venv python $PY_VER at $PYTHON_BIN"

if [[ "$PY_VER" == "3.13" ]]; then
  echo "[PiWebRTC] Python 3.13 detected — needs audioop-lts; piwheels may lack aiortc wheel"
fi

pi_apt_install_python_dev PiWebRTC "$PYTHON_BIN"

echo "[PiWebRTC] Upgrading pip (isolated, avoids broken system metadata)..."
"${PIP[@]}" install --isolated --no-cache-dir --no-deps --upgrade pip || true
"${PIP[@]}" install --isolated --no-cache-dir --no-deps --upgrade setuptools wheel || true

purge_pip_av

if ! verify_av 2>/dev/null; then
  echo "[PiWebRTC] ERROR: apt python3-av not importable."
  echo "  Run: sudo apt install -y python3-av ffmpeg"
  exit 1
fi

install_audioop_compat || {
  echo "[PiWebRTC] ERROR: audioop-lts required on Python $PY_VER"
  exit 1
}

echo "[PiWebRTC] Installing aiortc deps one-by-one (--no-deps, no resolver)..."
set +e
for pkg in google-crc32c pylibsrtp pyee ifaddr dnspython aioice; do
  if ! pip_one "$pkg"; then
    echo "[PiWebRTC] WARN: optional/failed pip package: $pkg"
  fi
  purge_pip_av
done

# cffi/cryptography often already satisfied via apt + system-site-packages
"$PYTHON_BIN" -c "import cffi, cryptography" 2>/dev/null || {
  pip_one cffi || true
  pip_one cryptography || true
}

echo "[PiWebRTC] Upgrading pyOpenSSL in venv (Bookworm system OpenSSL lacks DTLSv1_get_timeout)..."
pip_one "typing_extensions>=4.9.0" || true
pip_one "cryptography>=41.0.0,<44" || pip_one cryptography || true
# Pin <24 on Bookworm — pyopenssl 26.x needs newer typing_extensions than apt provides
pip_one "pyopenssl>=23.1.0,<24.0" || pip_one "pyopenssl==23.3.0" || true
if ! "$PYTHON_BIN" - <<'PY'
import OpenSSL
ver = tuple(int(x) for x in OpenSSL.__version__.split(".")[:2])
if ver < (23, 1):
    raise SystemExit(f"pyOpenSSL too old: {OpenSSL.__version__}")
import typing_extensions
print(f"[PiWebRTC] pyOpenSSL OK {OpenSSL.__version__}, typing_extensions OK")
PY
then
  echo "[PiWebRTC] WARN: pip pyOpenSSL upgrade failed — WebRTC DTLS may crash"
fi

echo "[PiWebRTC] Installing aiortc..."
check_pi_resources
PIP_RTC=1
AIORTC_VERSIONS=("1.6.0" "1.5.0")

# Try pre-built wheel first (no compile — avoids OSError on low RAM/disk).
for ver in "${AIORTC_VERSIONS[@]}"; do
  if install_aiortc_wheel "$ver"; then
    if try_verify_aiortc 2>/dev/null; then
      PIP_RTC=0
      echo "[PiWebRTC] aiortc==${ver} wheel OK"
      break
    fi
    echo "[PiWebRTC] aiortc==${ver} wheel installed but import failed — trying next..."
  fi
done

# Wheel failed or libvpx.so — compile against system libvpx (slow, needs swap).
if [[ $PIP_RTC -ne 0 ]]; then
  echo "[PiWebRTC] Wheel path failed — building from source (10-20 min on Pi)..."
  for ver in "${AIORTC_VERSIONS[@]}"; do
    if build_aiortc_from_source "$ver"; then
      reinstall_aiortc_runtime_deps
      if try_verify_aiortc; then
        PIP_RTC=0
        echo "[PiWebRTC] aiortc==${ver} source build OK"
        break
      fi
      echo "[PiWebRTC] aiortc==${ver} built but import failed — trying next..."
    fi
  done
fi

purge_pip_av

set -e

if [[ $PIP_RTC -ne 0 ]]; then
  echo "[PiWebRTC] FAILED to install aiortc on $ARCH / Python $PY_VER"
  diagnose_aiortc_import
  echo "[PiWebRTC] Manual check:"
  echo "  $PYTHON_BIN -c \"import aiortc; print(aiortc.__version__)\""
  echo "[PiWebRTC] Try:"
  echo "  bash scripts/pi-audioop-fix.sh"
  echo "  .venv/bin/pip install audioop-lts"
  echo "  sudo apt install -y python${PY_VER}-dev python3-dev build-essential libvpx9"
  echo "  sudo ldconfig"
  echo "  bash scripts/pi-install-webrtc.sh"
  exit 1
fi

echo "[PiWebRTC] Verifying imports..."
if ! verify_aiortc; then
  echo "[PiWebRTC] FAILED import check on $ARCH / Python $PY_VER"
  echo "  Try: .venv/bin/pip install pyopenssl>=23.1.0 cryptography"
  exit 1
fi

echo "[PiWebRTC] Success — restart scanner: bash scripts/pi-fix-and-run-ws.sh"
