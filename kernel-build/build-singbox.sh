#!/bin/bash
. /home/claude/gomod/env.sh
GOOS_T=${1:-windows}; GOARCH_T=${2:-amd64}; OUT=${3:-/home/claude/out/sing-box-$GOOS_T-$GOARCH_T}
[ "$GOOS_T" = windows ] && OUT="$OUT.exe"
cd /home/claude/work/JiajiaBox-main/native-src/sing-box
GOOS=$GOOS_T GOARCH=$GOARCH_T CGO_ENABLED=0 go build -modfile=/home/claude/gomod/sing-box.mod -trimpath -ldflags="-s -w" \
  -tags=with_conntrack,with_gvisor,with_quic,with_wireguard,with_utls,with_clash_api -o "$OUT" ./cmd/sing-box
echo "EXIT=$?"
