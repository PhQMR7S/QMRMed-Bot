#!/usr/bin/env bash
set -euo pipefail

apt-get update
apt-get install -y fonts-noto-core poppler-utils tesseract-ocr tesseract-ocr-ara tesseract-ocr-eng python3-pip
python3 -m pip install --break-system-packages 'reportlab>=4.4.0' rlbidi

echo
 echo 'QMRMed file-intelligence runtime is ready.'
echo 'PDF renderer: system python3 + ReportLab/rlbidi'
echo 'OCR: tesseract + poppler-utils'
