#!/bin/bash
cd "$(dirname "$0")"
export NODE_OPTIONS="--no-warnings"
echo "🚀 Starting MT-Aigis..."
npx electron .
echo "MT-Aigis exited."
