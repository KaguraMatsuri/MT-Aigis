#!/bin/bash
cd "$(dirname "$0")"
export NODE_OPTIONS="--no-warnings"
npx electron . 2>&1 | tee -a .mt-aigis.log
