#!/usr/bin/env bash
# Purge GitHub's camo cache for every image proxied in the rendered README.
#
# camo caches by URL, so a badge whose content changed keeps rendering stale
# until its cache entry is dropped. Note this does NOT cover the star-history
# chart: GitHub serves raw.githubusercontent.com URLs verbatim rather than
# through camo, so the chart refreshes on its own max-age=300.
#
#   $1  owner/repo   (default: $GITHUB_REPOSITORY)
#   $2  branch       (default: main)
set -uo pipefail

repo="${1:-${GITHUB_REPOSITORY:?owner/repo required}}"
branch="${2:-main}"
page="https://github.com/$repo/blob/$branch/README.md"

# camo URLs only exist in the *rendered* page, so this reads github.com rather
# than the file on disk. grep exits 1 on no match, which is not an error here.
urls="$(curl -sL "$page" | grep -Eo 'https://camo\.githubusercontent\.com/[a-zA-Z0-9/]+' | sort -u)"

if [ -z "$urls" ]; then
  echo "No camo-proxied images found on $page; nothing to purge."
  exit 0
fi

while IFS= read -r url; do
  echo "Purging: $url"
  curl -s -o /dev/null -X PURGE "$url"
done <<< "$urls"
