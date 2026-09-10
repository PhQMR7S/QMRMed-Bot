#!/usr/bin/env python3
import re
import sys
import zipfile
import xml.etree.ElementTree as ET


def local_text(xml_bytes):
    root = ET.fromstring(xml_bytes)
    values = []
    for node in root.iter():
        if node.tag.endswith('}t') and node.text:
            values.append(node.text)
        elif node.tag.endswith('}br'):
            values.append('\n')
    return ' '.join(values)


def extract_docx(path):
    with zipfile.ZipFile(path) as z:
        return local_text(z.read('word/document.xml'))


def extract_pptx(path):
    slides = []
    with zipfile.ZipFile(path) as z:
        names = sorted(n for n in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml', n))
        for name in names:
            slides.append(local_text(z.read(name)))
    return '\n\n'.join(f'Slide {i + 1}\n{value}' for i, value in enumerate(slides))


if len(sys.argv) != 2:
    raise SystemExit('usage: extract-office.py FILE')

path = sys.argv[1]
ext = path.lower().rsplit('.', 1)[-1]
if ext == 'docx':
    text = extract_docx(path)
elif ext == 'pptx':
    text = extract_pptx(path)
else:
    raise SystemExit(f'unsupported office type: {ext}')

print(re.sub(r'\n{3,}', '\n\n', text).strip())
