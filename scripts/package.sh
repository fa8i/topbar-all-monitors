#!/usr/bin/env bash
set -euo pipefail

UUID="topbar-all-monitors@fa8i.github.io"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${PROJECT_DIR}/${UUID}"
DIST_DIR="${PROJECT_DIR}/dist"
ZIP_PATH="${DIST_DIR}/${UUID}.zip"

if [[ ! -d "${SOURCE_DIR}" ]]; then
  echo "Source directory not found: ${SOURCE_DIR}" >&2
  exit 1
fi

for required_file in metadata.json extension.js stylesheet.css; do
  if [[ ! -f "${SOURCE_DIR}/${required_file}" ]]; then
    echo "Missing required file: ${SOURCE_DIR}/${required_file}" >&2
    exit 1
  fi
done

rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

(
  cd "${SOURCE_DIR}"
  zip -r "${ZIP_PATH}" . \
    -x '*.git*' \
    -x '*~' \
    -x '*.bak'
)

echo "Created package:"
echo "  ${ZIP_PATH}"
