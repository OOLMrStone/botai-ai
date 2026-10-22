#!/usr/bin/env python3
"""Write test-shop credentials privately. Never accepts secrets in argv or prints them."""
import getpass
import os
from pathlib import Path
import re
import sys
import warnings


def main():
    if len(sys.argv) != 1:
        raise ValueError("Run without arguments")
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        raise ValueError("An interactive terminal is required")
    warnings.simplefilter("error", getpass.GetPassWarning)
    target = Path(__file__).resolve().parents[2] / "runtime" / ".env.billing-test"
    target.parent.mkdir(exist_ok=True)
    if target.exists() or target.is_symlink():
        raise ValueError("Credential file already exists; move it privately before setup")
    shop_id = getpass.getpass("Test shop ID (hidden): ").strip()
    secret = getpass.getpass("Test secret key (hidden): ").strip()
    if not re.fullmatch(r"[0-9]{1,32}", shop_id) or not re.fullmatch(r"test_[A-Za-z0-9_-]{7,}", secret):
        raise ValueError("Only test shop credentials are accepted")
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(f"APP_BILLING_SHOP_ID={shop_id}\nAPP_BILLING_SECRET_KEY={secret}\n")
    print(f"TEST_CREDENTIALS_SAVED {target}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, EOFError, KeyboardInterrupt, getpass.GetPassWarning):
        # Do not print exception text: platform errors could include sensitive input.
        print("TEST_CREDENTIALS_NOT_SAVED: check test inputs and whether the private file exists", file=sys.stderr)
        sys.exit(1)
