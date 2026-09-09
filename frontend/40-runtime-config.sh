#!/bin/sh
set -eu

: "${FRONTEND_API_BASE_URL:=https://opsapi.epds.hu/api}"
export FRONTEND_API_BASE_URL

envsubst '${FRONTEND_API_BASE_URL}' \
  < /opt/epds/runtime-config.template.js \
  > /usr/share/nginx/html/runtime-config.js
