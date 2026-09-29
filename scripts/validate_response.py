#!/usr/bin/env python3
"""Standalone offline validator; shares the exact implementation with the service."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.grading.validator import (DEFAULT_CATALOG, SCHEMA, ValidationGate,
    load_error_codes, main, parse_response, validate_response)

if __name__ == "__main__":
    sys.exit(main())
