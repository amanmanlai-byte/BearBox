#!/usr/bin/env python3
"""Generate an overlay go.mod that redirects vanity-domain modules to GitHub mirrors.
Usage: mkmod.py <src go.mod> <dst .mod>   (go.sum copied alongside as dst .sum)"""
import re, sys, shutil, os
src, dst = sys.argv[1], sys.argv[2]
MAP = {
 'filippo.io/age':'github.com/FiloSottile/age',
 'filippo.io/edwards25519':'github.com/FiloSottile/edwards25519',
 'filippo.io/hpke':'github.com/FiloSottile/hpke',
 'go.uber.org/multierr':'github.com/uber-go/multierr',
 'go.uber.org/zap':'github.com/uber-go/zap',
 'go.uber.org/zap/exp':'github.com/uber-go/zap/exp',
 'go4.org/mem':'github.com/go4org/mem',
 'go4.org/netipx':'github.com/go4org/netipx',
 'golang.zx2c4.com/wireguard/wgctrl':'github.com/WireGuard/wgctrl-go',
 'golang.zx2c4.com/wireguard/windows':'github.com/WireGuard/wireguard-windows',
 'google.golang.org/genproto/googleapis/rpc':'github.com/googleapis/go-genproto/googleapis/rpc',
 'google.golang.org/grpc':'github.com/grpc/grpc-go',
 'google.golang.org/protobuf':'github.com/protocolbuffers/protobuf-go',
 'gopkg.in/yaml.v3':'github.com/go-yaml/yaml',
 'howett.net/plist':'github.com/DHowett/go-plist',
 'lukechampine.com/blake3':'github.com/lukechampine/blake3',
 'zombiezen.com/go/capnproto2':'github.com/capnproto/go-capnproto2',
}
txt = open(src).read()
reps=[]
already = set(re.findall(r'^replace\s+(\S+)', txt, re.M))
for m in re.finditer(r'^\s+(\S+)\s+(v\S+?)(?:\s*//.*)?$', txt, re.M):
    mod, ver = m.group(1), m.group(2)
    if mod in already: continue
    tgt = MAP.get(mod)
    if tgt is None and mod.startswith('golang.org/x/'):
        tgt = 'github.com/golang/' + mod.split('/')[2]
    if tgt:
        if mod=='gopkg.in/yaml.v3' and ver=='v3.0.1':
            ver='v0.0.0-20220527190237-f6f7691b1fde'
        reps.append(f'replace {mod} => {tgt} {ver}')
if 'golang.zx2c4.com/wintun ' in txt:
    reps.append('replace golang.zx2c4.com/wintun => /home/claude/gomod/stubs/wintun')
open(dst,'w').write(txt.rstrip('\n') + '\n\n// --- sandbox overlay: GitHub mirrors for vanity domains ---\n' + '\n'.join(reps) + '\n')
sumsrc = os.path.join(os.path.dirname(src), 'go.sum')
if os.path.exists(sumsrc):
    shutil.copy(sumsrc, dst[:-4] + '.sum')
print(f'{len(reps)} replaces written to {dst}')
