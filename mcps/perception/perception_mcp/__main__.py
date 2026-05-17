from __future__ import annotations

import argparse
import json

from .server import build_status, mcp


def main() -> None:
    parser = argparse.ArgumentParser(description="Active Geo local perception MCP server.")
    parser.add_argument("--check", action="store_true", help="Print backend status and exit.")
    args = parser.parse_args()

    if args.check:
        print(json.dumps(build_status(), indent=2))
        return

    mcp.run()


if __name__ == "__main__":
    main()
