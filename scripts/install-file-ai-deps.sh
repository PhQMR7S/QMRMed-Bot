#!/usr/bin/env bash
set -euo pipefail

apt-get update
apt-get install -y fonts-noto-core poppler-utils tesseract-ocr tesseract-ocr-ara tesseract-ocr-eng python3-venv

python3 -m venv .qmrmed-file-ai-venv
.qmrmed-file-ai-venv/bin/pip install --upgrade pip
.qmrmed-file-ai-venv/bin/pip install 'reportlab>=4.4.0' rlbidi

echo
 echo 'QMRMed file-intelligence runtime is ready.'
echo 'PDF renderer: .qmrmed-file-ai-venv/bin/python'
echo 'OCR: tesseract + poppler-utils'
