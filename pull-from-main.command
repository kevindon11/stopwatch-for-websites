#!/bin/bash

# Always run from the folder this script lives in.
cd "$(dirname "$0")" || exit 1

# Pull the latest changes from main.
git pull origin main

# Keep the terminal open when launched by double-click.
echo
read -r -p "Done. Press Enter to close..." _
