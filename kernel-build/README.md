# Windows kernel build notes

Kernel source: `native-src/sing-box` from the original archive (1.14.3-Jiajia-7), unmodified.
Tags: with_conntrack,with_gvisor,with_quic,with_wireguard,with_utls,with_clash_api (same as native-src/build.sh).

Build environment used: Go 1.27.3 (conda-forge; project used 1.25.8), GOOS=windows GOARCH=amd64 CGO_ENABLED=0.
The sandbox could not reach proxy.golang.org / golang.org, so `mkmod.py` writes an overlay go.mod (used via `-modfile`)
that redirects vanity-domain modules to their GitHub mirrors. Original go.mod/go.sum are untouched.
Integrity note: replaced modules are not verified against the original go.sum (GOSUMDB=off). Re-verify on a machine with normal access.

golang.zx2c4.com/wintun is replaced with github.com/MetaCubeX/wintun-go (commit in WINTUN_COMMIT.txt), same module path and API.
