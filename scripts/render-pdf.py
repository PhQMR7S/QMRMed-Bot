#!/usr/bin/env python3
import json
import os
import re
import sys
from xml.sax.saxutils import escape


def has_arabic(text):
    return bool(re.search(r'[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]', text))


def find_font():
    candidates = [
        '/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf',
        '/usr/share/fonts/opentype/noto/NotoNaskhArabic-Regular.ttf',
        '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return None


def main():
    if len(sys.argv) != 2:
        raise SystemExit('usage: render-pdf.py INPUT_JSON')
    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        data = json.load(f)

    try:
        from reportlab.lib.enums import TA_RIGHT, TA_LEFT
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
    except Exception as exc:
        raise SystemExit(f'ReportLab is not installed or is too old: {exc}')

    font = find_font()
    if not font:
        raise SystemExit('No Unicode font found. Install fonts-noto-core or fonts-dejavu-core.')
    pdfmetrics.registerFont(TTFont('QMRFont', font))

    text = str(data.get('text', '')).strip()
    title = str(data.get('title', 'QMRMed'))
    signature = str(data.get('signature', 'QMRMed — Medical Education Platform'))
    output = str(data['output'])
    arabic = has_arabic(text) or has_arabic(title)

    doc = SimpleDocTemplate(output, pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=18 * mm, bottomMargin=18 * mm)
    title_style = ParagraphStyle('Title', fontName='QMRFont', fontSize=17, leading=23, alignment=TA_RIGHT if arabic else TA_LEFT, spaceAfter=10)
    body_style = ParagraphStyle('Body', fontName='QMRFont', fontSize=11.5, leading=18, alignment=TA_RIGHT if arabic else TA_LEFT, wordWrap='RTL' if arabic else 'LTR', spaceAfter=7)
    sig_style = ParagraphStyle('Signature', fontName='QMRFont', fontSize=9.5, leading=14, alignment=TA_RIGHT if arabic else TA_LEFT, spaceBefore=12)

    story = [Paragraph(escape(title), title_style), Spacer(1, 3 * mm)]
    for block in re.split(r'\n\s*\n', text):
        block = block.strip()
        if not block:
            continue
        safe = escape(block).replace('\n', '<br/>')
        story.append(Paragraph(safe, body_style))
    story.append(Spacer(1, 5 * mm))
    story.append(Paragraph(escape(signature), sig_style))
    doc.build(story)
    print(output)


if __name__ == '__main__':
    main()
