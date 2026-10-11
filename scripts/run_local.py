#!/usr/bin/env python3
"""Source and PyInstaller entry point for the portable local application."""
import sys
from pathlib import Path

if not getattr(sys, 'frozen', False):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.local.launcher import main

if __name__ == '__main__':
    raise SystemExit(main())
