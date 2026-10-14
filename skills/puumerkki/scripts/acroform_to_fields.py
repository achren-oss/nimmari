#!/usr/bin/env python3
"""Remove native form controls and export Puumerkki overlays (requires pypdf)."""
import argparse
import json
import math
from pathlib import Path
import sys

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, NameObject


def inherited(widget, name, default=None):
    node = widget
    seen = set()
    while node is not None and id(node) not in seen:
        seen.add(id(node))
        if name in node:
            return node[name]
        parent = node.get('/Parent')
        node = parent.get_object() if parent else None
    return default


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('--output-dir', type=Path, required=True, help='New directory for flattened.pdf and fields.json')
    parser.add_argument('--skip-prefix', action='append', default=[], help='Drop matching field names; repeatable')
    parser.add_argument('--private', action='append', default=[], metavar='NAME=signerKey', help='Required private hetu assigned to this key; repeatable')
    args = parser.parse_args()
    private = {}
    for assignment in args.private:
        name, separator, key = assignment.partition('=')
        if not separator or not name.strip() or not key.strip():
            parser.error('--private requires NAME=signerKey')
        private[name] = key
    reader = PdfReader(args.pdf)
    writer = PdfWriter()
    fields = []
    names = set()
    for index, page in enumerate(reader.pages):
        if page.rotation or float(page.mediabox.left) or float(page.mediabox.bottom) or page.cropbox != page.mediabox:
            raise ValueError('Normalize rotated/cropped/offset pages before converting')
        scale = 800 / float(page.mediabox.width)
        height = float(page.mediabox.height)
        retained = ArrayObject()
        for reference in page.get('/Annots', []):
            widget = reference.get_object()
            if widget.get('/Subtype') != '/Widget':
                retained.append(reference)
                continue
            # Widgets are removed even when skipped: no native control survives.
            name = str(inherited(widget, '/T', ''))
            if any(name.startswith(prefix) for prefix in args.skip_prefix):
                continue
            field_type = inherited(widget, '/FT')
            if field_type not in ('/Tx', '/Btn', '/Ch', '/Sig'):
                raise ValueError('Unsupported AcroForm field type')
            if not name or name in names:
                raise ValueError('Fields need unique names; normalize repeated widgets first')
            names.add(name)
            x1, y1, x2, y2 = map(float, widget['/Rect'])
            overlay_height = (y2 - y1) * scale
            minimum_height = 40 * scale if field_type == '/Sig' else 20
            extra = max(0, minimum_height - overlay_height) if field_type != '/Btn' else 0
            output_height = max(10, round(overlay_height + extra))
            output_y = round((height - y2) * scale - extra)
            if field_type == '/Sig':
                output_height = max(output_height, math.ceil(40 * scale))
                output_y = round((height - y1) * scale) - output_height
            field = dict(name=name, label=name,
                         type='signature' if field_type == '/Sig' else 'checkbox' if field_type == '/Btn' else ('textarea' if field_type == '/Tx' and y2-y1 > 25 else 'text'),
                         page=index, x=round(x1*scale), y=output_y,
                         width=max(10, round((x2-x1)*scale)), height=output_height,
                         required=bool(int(inherited(widget, '/Ff', 0)) & 2))
            if name in private:
                field.update(type='hetu', required=True, privateForOtherSigners=True, assignedSignerKey=private[name])
            fields.append(field)
        if retained:
            page[NameObject('/Annots')] = retained
        elif '/Annots' in page:
            del page['/Annots']
        writer.add_page(page)
    if set(private) - names:
        raise ValueError('--private names must match retained fields')
    if '/AcroForm' in writer.root_object:
        del writer.root_object['/AcroForm']
    args.output_dir.mkdir(parents=True, exist_ok=False)
    writer.write(args.output_dir / 'flattened.pdf')
    (args.output_dir / 'fields.json').write_text(json.dumps({'fields': fields}, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'pages': len(reader.pages), 'fields': len(fields)}))
    print('Reminder: assign signature boxes to each signer key and add any missing signature lines. Native widget values/appearances were removed; inspect every page.', file=sys.stderr)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError):
        print('Conversion failed; check the input PDF, field names and output directory.', file=sys.stderr)
        sys.exit(1)
