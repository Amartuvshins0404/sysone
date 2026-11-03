#!/usr/bin/env bash
set -euo pipefail

for dir in packages/*/; do
  name=$(node -p "require('./${dir}package.json').name")
  npm trust github "$name" --file=ci.yml --repo=Amartuvshins0404/sysone --allow-publish --yes
done
npm trust list sysonejs
