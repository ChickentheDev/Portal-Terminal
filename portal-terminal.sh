#!/bin/bash
cd /app/share/portal-terminal
exec electron . --no-sandbox "$@"
