#!/usr/bin/env python3
"""Copy the exact approved DejaVu fonts from an installed distribution, offline."""
import argparse,hashlib,struct
from pathlib import Path
from acquire import private_directory,private_write

FONTS={
    'DejaVuSerif.ttf':'42d1edeb7952f31b1f96d767ed7030b08a39e0c372b0071641518864e2bffb51',
    'DejaVuSerif-Italic.ttf':'2e39b1d50f90b933b00c7bb54a96afd3f86419b3d717c7cf202e36f2d4973e47'}

TIMES_FONT=('Times New Roman.ttf','f3b4ffff71c2a0c7227d37497683b2498fb2d0a4e8beae26f022e3ccfcaabfa3')

def prepare(source,root,times_font=None):
    from bankzadach_media import safe_file
    checked={}
    for name,sha in FONTS.items():
        raw=safe_file(source,name,1024*1024)
        if hashlib.sha256(raw).hexdigest()!=sha:raise ValueError('approved_font_hash_required')
        checked[name]=raw
    # Read the license carried by this exact, hash-verified font; no external lookup.
    raw=checked['DejaVuSerif.ttf'];count=struct.unpack_from('>H',raw,4)[0]
    tables={raw[12+i*16:16+i*16]:struct.unpack_from('>II',raw,20+i*16) for i in range(count)}
    off,_=tables[b'name'];_,count,start=struct.unpack_from('>HHH',raw,off);licenses=[]
    for i in range(count):
        platform,_,_,name,length,pos=struct.unpack_from('>6H',raw,off+6+i*12)
        if name==13:licenses.append(raw[off+start+pos:off+start+pos+length].decode('utf-16-be' if platform in [0,3] else 'mac_roman'))
    license_text=max(licenses,key=len)
    if 'Permission' not in license_text:raise ValueError('font_license_required')
    out=root/'renderer-fonts';private_directory(out)
    for name,raw in checked.items():private_write(out/name,raw)
    private_write(out/'LICENSE.txt',license_text.encode())
    if times_font is not None:
        raw=safe_file(times_font.parent,times_font.name,1024*1024)
        if hashlib.sha256(raw).hexdigest()!=TIMES_FONT[1]:raise ValueError('approved_times_font_hash_required')
        private_write(out/TIMES_FONT[0],raw)
        private_write(out/'Times-license-notice.txt',b'Local rendering only using an existing licensed macOS font. Copyright 2006 The Monotype Corporation. All Rights Reserved. Use is subject to the EULA of the product containing this font. Do not distribute the font or commit it to the repository.')
    return out

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source-dir',type=Path,required=True);parser.add_argument('--root',type=Path,required=True);parser.add_argument('--times-font',type=Path);args=parser.parse_args()
    print(prepare(args.source_dir.resolve(),args.root.resolve(),args.times_font.resolve() if args.times_font else None))
